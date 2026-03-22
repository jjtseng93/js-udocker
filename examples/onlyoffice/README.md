# Notice
- This example uses 
- ONLYOFFICE Document Server (AGPL v3).
- Base version:
  * ONLYOFFICE Document Server 9.3.1.2
- No modifications are made to the original ONLYOFFICE source code.
- All changes are applied via external configuration and bind-mounted override files.
  
## Modifications:
- The following files override upstream files
- via js-udocker compose bind mounts:
  - ./run-document-server.sh:/app/ds/run-document-server.sh
  - ./nginx_welcome:/etc/nginx/sites-enabled/default
  - ./ds.conf.tmpl:/etc/onlyoffice/documentserver/nginx/ds.conf.tmpl
  - ./ds-adminpanel.conf:/etc/supervisor/conf.d/ds-adminpanel.conf
  
## Source code:
- Original:
- https://hub.docker.com/r/onlyoffice/documentserver
- Modified files: included in this repository

## Build / run:
- sh termux_install.sh
- cd to this example's folder
- udocker compose up
