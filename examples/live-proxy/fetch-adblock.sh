#!/bin/bash
curl "https://easylist.to/easylist/easylist.txt" | grep '##' | gzip -9 > ./adblock.gz
