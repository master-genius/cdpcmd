#!/bin/bash

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

INSTALL_LIST="cdpc install.sh webserver makesystemd.js node_modules package.json package-lock.json"

install_cdpc () {
    
    cd $SELFDIR

    if [ ! -d "$CDPC_DIR" ] ; then
        sudo mkdir -p $CDPC_DIR
    fi

    sudo cp -R $INSTALL_LIST $CDPC_DIR

    if [ ! -d "$CDPC_DIR/config" ] ; then
        sudo mkdir "$CDPC_DIR/config"
    fi

    if [ ! -d "$CDPC_DIR/webserver/config" ] ; then
        sudo mkdir "$CDPC_DIR/webserver/config"
    fi

    if [ ! -f "$CDPC_DIR/webserver/config/apitk" ] ; then
        node ./mktk.js > tmp/apitk
        sudo mv tmp/apitk "$CDPC_DIR/webserver/config/"
    fi

    sudo cp cdpc $CDPC_CMD_DIR

    node makesystemd.js > tmp/$SYSTEMD_FILE

    sudo cp $SYSTEMD_FILE $SYSTEMD_PATH && \
    sudo systemctl enable $SYSTEMD_FILE && \
    sudo systemctl start $SYSTEMD_FILE
}

if [ "$#" -gt 0 ] ; then
    for a in $@ ; do
        
        if [ "$a" = "-u" ] ; then
            install_cdpc
            exit $?
        fi

    done

fi

#ubuntu、debian、deepin、mint
OSNAME="ubuntu"
CHECK_NAME=`cat /etc/os-release | egrep '^NAME=.*CentOS|^NAME=.*RedHat'`

if [ -n "$CHECK_NAME" ] ; then
    OSNAME="centos"
fi

if [ -z `which curl` ] ; then
    if [ $OSNAME = "ubuntu" ] ; then
        sudo apt install curl -y
    else
        sudo yum install curl -y
    fi
fi

if [ -z `which git` ] ; then
    if [ $OSNAME = "ubuntu" ] ; then
        sudo apt install git -y
    else
        sudo yum install git -y
    fi
fi

if [ "$?" -ne 0 ] ; then
    exit 1
fi

if ! which node ; then
    cd $TMPDIR && git clone 'https://gitee.com/daoio/mno' && cd mno && bash install.sh

    if [ "$?" -ne 0 ] ; then
        echo "安装Node.js失败，稍后重试或手动安装Node.js. "
        echo "(Install Node.js failed, try again or install node.js by yourself.)"
        exit 1
    fi

fi

if [ "$CDPC_DIR" != "$SELFDIR" ] ; then
    install_cdpc
fi
