#!/bin/bash

if [ "$UID" -ne 0 ] ; then
    echo "目前cdpcmd的安装需要root用户身份，请使用sudo来执行，或者su切换到root用户再次运行。"
    echo "(You need to use sudo run $0 or su switch to root and run $0 again.)"
    exit 1
fi

cd $(dirname "$0")

SELFDIR=`pwd`
TMPDIR="$SELFDIR/tmp"

if [ ! -d "./tmp" ] ; then
    mkdir tmp
fi

#安装软件所在路径
CDPC_DIR=/usr/local/cdpc

#安装命令所在路径
CDPC_CMD_DIR=/usr/local/bin/cdpc

SYSTEMD_FILE=cdpcd.service

SYSTEMD_PATH=/lib/systemd/system

INSTALL_LIST="cdpcd.js cdpc install.sh webserver node_modules package.json package-lock.json auth.js helpdoc outstatus.js runstatus.js lib config init-start.js combine-status-result.js parseNameApp.js disable-or-enable.js inspect.js sockop.js socketpath.js makesystemd.js mktk.js"

# 清理旧版文件通道残留：新版不再读写它们，留着会让 CLI 把"daemon 没跑"
# 误判成"升级后尚未重启"（CLI 用这个目录作为半升级状态的线索）。
# 必须在 daemon 重启之后执行——旧 daemon 的自愈逻辑会把目录重建回来。
clean_legacy_channel() {
    rm -rf /tmp/cdpcd_watch

    if [ -d "$CDPC_DIR/uauth" ] ; then
        for u in `ls "$CDPC_DIR/uauth" 2>/dev/null` ; do
            UHOME=`cat "$CDPC_DIR/uauth/$u" 2>/dev/null`
            case "$UHOME" in
                /*) rm -rf "$UHOME/.cdpc/watch" ;;
            esac
        done
    fi
}

# 等待新 daemon 建立 sock 控制通道，明确报告结果而不是静默返回。
wait_channel_ready() {
    for i in 1 2 3 4 5 6 7 8 9 10 ; do
        if [ -S /run/cdpcd/cdpcd.sock ] || [ -S "$CDPC_DIR/run/cdpcd.sock" ] ; then
            echo "控制通道已就绪。"
            clean_legacy_channel
            return 0
        fi
        sleep 1
    done

    echo "警告：未检测到控制通道（/run/cdpcd/cdpcd.sock）。"
    echo "请检查服务状态与 $CDPC_DIR/logs/cdpcd.log。"
    return 1
}

init_systemd_service() {
    node makesystemd.js > tmp/$SYSTEMD_FILE

    mv tmp/$SYSTEMD_FILE $SYSTEMD_PATH

    systemctl daemon-reload

    IS_ENABLED=`systemctl is-enabled $SYSTEMD_FILE 2>/dev/null`

    if [ "$IS_ENABLED" != "enabled" ] ; then
        systemctl enable $SYSTEMD_FILE
        systemctl start $SYSTEMD_FILE
        return 0
    fi

    # 已启用说明是升级：控制通道从文件事件改为 unix socket 后，
    # 旧 daemon 不会创建 sock，而新 CLI 只认 sock——不重启就会留下
    # 「命令全部失效但看不出原因」的窗口。所以升级必须重启。
    #
    # 注意：被管子进程一律非 detached，与 cdpcd 同生死，
    # 重启 cdpcd 会连带重启全部服务（这是既有行为，不是本次改动引入）。
    if systemctl is-active --quiet $SYSTEMD_FILE ; then
        echo "检测到 cdpcd 正在运行，升级需要重启它以启用 sock 控制通道。"
        echo "注意：重启会连带重启全部被管服务（子进程与 cdpcd 同生死）。"
        systemctl restart $SYSTEMD_FILE
    else
        systemctl start $SYSTEMD_FILE
    fi

    wait_channel_ready
}

init_rc_service() {
    #服务脚本复制到/etc/init.d，/etc/rc3.d 和 /etc/rc5.d创建符号链接
    if [ ! -x "cdpc-rc-service" ] ; then
        chmod +x cdpc-rc-service
    fi

    cp cdpc-rc-service /etc/init.d/cdpc

    RC_DIR_LIST="rc2.d rc3.d rc5.d"
    for r in $RC_DIR_LIST ; do
        if [ -f "/etc/$r/S07cdpc" ] ; then
            rm "/etc/$r/S07cdpc"
        fi
        ln -s ../init.d/cdpc "/etc/$r/S07cdpc"
    done
    
    # 升级时必须 restart：cdpc-rc-service 的 start 检测到进程在跑就直接返回，
    # 那样跑的仍是旧代码（无 sock 通道），新 CLI 会全部失效。
    # 同样注意：重启 cdpcd 会连带重启全部被管服务。
    if ps -e -o ppid,args | grep -E -i '^\s*1\s+node.+cdpcd' | grep -qv grep ; then
        echo "检测到 cdpcd 正在运行，升级需要重启它以启用 sock 控制通道。"
        echo "注意：重启会连带重启全部被管服务（子进程与 cdpcd 同生死）。"
        /etc/init.d/cdpc restart
    else
        /etc/init.d/cdpc start
    fi

    wait_channel_ready
}

IS_SYSTEMD=`ps -e -o ppid,pid,comm | grep -E -i '^\s*0\s+1\s+systemd'`

install_cdpc () {
    
    cd $SELFDIR

    if [ ! -d "$CDPC_DIR" ] ; then
        mkdir -p $CDPC_DIR
    fi

    sudo cp -R $INSTALL_LIST $CDPC_DIR

    # cp -R 只覆盖不删除：清理已从项目移除的旧脚本，
    # 否则它们会永久残留在安装目录里（文件通道时代的三个脚本）
    for stale in mapnametocmd.js noticeApp.js get_app_state.js ; do
        if [ -f "$CDPC_DIR/$stale" ] ; then
            rm -f "$CDPC_DIR/$stale"
        fi
    done

    if [ ! -d "$CDPC_DIR/config" ] ; then
        mkdir "$CDPC_DIR/config"
    fi

    if [ ! -d "$CDPC_DIR/limit" ] ; then
        mkdir "$CDPC_DIR/limit"
    fi

    if [ ! -d "$CDPC_DIR/logs" ] ; then
        mkdir "$CDPC_DIR/logs"
    fi

    if [ ! -d "$CDPC_DIR/webserver/config" ] ; then
        mkdir "$CDPC_DIR/webserver/config"
    fi

    if [ ! -f "$CDPC_DIR/webserver/config/apitk" ] ; then
        node ./mktk.js > tmp/apitk
        mv tmp/apitk "$CDPC_DIR/webserver/config/"
        chmod 640 "$CDPC_DIR/webserver/config/apitk"
    fi

    WEB_SERVER_CERT_PATH="$CDPC_DIR/webserver/config/cert"

    if [ ! -d "$WEB_SERVER_CERT_PATH" ] ; then
        mkdir $WEB_SERVER_CERT_PATH
    fi

    if [ -d "$SELFDIR/config/cert" ] ; then
        cp -R "$SELFDIR/config/cert/*" "$WEB_SERVER_CERT_PATH/"
    fi

    if [ ! -x cdpc ] ; then
        chmod +x cdpc
    fi

    cp cdpc $CDPC_CMD_DIR

    if [ -n "$IS_SYSTEMD" ] ; then
        init_systemd_service
    else
        init_rc_service
    fi
}

if [ "$#" -gt 0 ] ; then
    for a in $@ ; do
        
        if [ "$a" = "-u" ] ; then
            install_cdpc
            exit $?
        fi

    done

fi

#ubuntu、debian、deepin、mint、mxlinux
OSNAME="ubuntu"

CHECK_NAME=`cat /etc/os-release | grep -E -i '^NAME=.*CentOS|^NAME=.*RedHat'`

if [ -n "$CHECK_NAME" ] ; then
    OSNAME="centos"
fi

CHECK_NAME=`cat /etc/os-release | grep -E -i '^NAME=.*Manjaro|^NAME=.*Arch'`

if [ -n "$CHECK_NAME" ] ; then
    OSNAME="arch"
fi

if [ -z `which curl` ] ; then
    if [ $OSNAME = "ubuntu" ] ; then
        sudo apt install curl -y
    elif [ $OSNAME = "centos" ] ; then
        sudo yum install curl -y
    else
        pacman -Sy curl --noconfirm
    fi
fi

if [ -z `which git` ] ; then
    if [ $OSNAME = "ubuntu" ] ; then
        apt install git -y
    elif [ $OSNAME = "centos" ] ; then
        yum install git -y
    else
        pacman -Sy git --noconfirm
    fi
fi

if [ "$?" -ne 0 ] ; then
    exit 1
fi

if [ -z `which node` ] ; then
    
    if [ -d "$TMPDIR/mno" ] ; then
        rm -rf "$TMPDIR/mno"
    fi

    cd $TMPDIR && git clone 'https://gitee.com/daoio/mno' && cd mno && bash install.sh

    if [ "$?" -ne 0 ] ; then
        echo "安装Node.js失败，稍后重试或手动安装Node.js. "
        echo "(Install Node.js failed, try again or install node.js by yourself.)"
        exit 1
    fi
else
    if [ ! -L "/usr/local/bin/node" ] ; then
        NODE_WHERE=`which node`
        ln -s $NODE_WHERE /usr/local/bin/node
    fi
fi

if [ "$CDPC_DIR" != "$SELFDIR" ] ; then
    install_cdpc && echo 'OK'
fi
