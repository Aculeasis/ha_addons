#!/bin/sh

sudo systemctl stop remote-smart.service
sudo systemctl disable remote-smart.service
sudo rm /etc/systemd/system/remote-smart.service
sudo systemctl daemon-reload
