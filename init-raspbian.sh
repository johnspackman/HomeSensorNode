#!/bin/bash

if [[ `whoami` != 'root' ]] ; then
  echo "Restarting with sudo..."
  sudo $0 $1
  exit
fi

apt-get update
apt-get upgrade -y
apt-get install vim git -y

cd 
wget https://unofficial-builds.nodejs.org/download/release/v12.9.1/node-v12.9.1-linux-armv6l.tar.gz
cd /opt
tar xfz ~/node-v12.9.1-linux-armv6l.tar.gz
ln -s node-v12.9.1-linux-armv6l node

echo 'export PATH=$PATH:/opt/node/bin
' > /etc/profile.d/nodejs.sh

