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

INSTALL_LIST="cdpcd.js cdpc install.sh webserver node_modules package.json package-lock.json auth.js helpdoc outstatus.js lib config init-start.js"

init_systemd_service() {
    node makesystemd.js > tmp/$SYSTEMD_FILE

    mv tmp/$SYSTEMD_FILE $SYSTEMD_PATH
    
    systemctl daemon-reload
    
    IS_ENABLED=`systemctl is-enabled $SYSTEMD_FILE`

    if [ "$IS_ENABLED" != "enabled" ] ; then
        systemctl enable $SYSTEMD_FILE
        systemctl start $SYSTEMD_FILE
    fi
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
    
    /etc/init.d/cdpc start
}

IS_SYSTEMD=`ps -e -o ppid,pid,comm | grep -E -i '^\s*0\s+1\s+systemd'`

install_cdpc () {
    
    cd $SELFDIR

    if [ ! -d "$CDPC_DIR" ] ; then
        mkdir -p $CDPC_DIR
    fi

    sudo cp -R $INSTALL_LIST $CDPC_DIR

    if [ ! -d "$CDPC_DIR/config" ] ; then
        mkdir "$CDPC_DIR/config"
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
    if [ -n "$IS_SYSTEMD" ] ; then
        if [ ! -f "/usr/local/bin/node" ] ; then
            NODE_WHERE=`which node`
            ln -s $NODE_WHERE /usr/local/bin/node
        fi
    fi
fi

if [ "$CDPC_DIR" != "$SELFDIR" ] ; then
    install_cdpc && echo 'OK'
fi
