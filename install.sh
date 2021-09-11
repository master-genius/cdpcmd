#!/bin/bash

cd $(dirname "$0")

SELFDIR=`pwd`
TMPDIR="$SELFDIR/tmp"

if [ ! -d "./tmp" ] ; then
    mkdir tmp
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

#安装软件所在路径
CDPC_DIR=/usr/local/cdpc

#安装命令所在路径
CDPC_CMD_DIR=/usr/local/bin/cdpc


