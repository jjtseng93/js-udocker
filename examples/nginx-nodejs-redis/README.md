# Original sample from:
- https://github.com/docker/awesome-compose/tree/master/nginx-nodejs-redis

# Note
- This compose example requires a modified version of proot to work properly in Termux to do port mapping correctly
- You can compile it yourself at
- https://github.com/termux/proot/issues/339
- or else you'll have to manually modify the default port numbers

## Compose sample application

## Node.js app with Nginx proxy and Redis database

Project structure:
```
.
├── README.md
├── compose.yaml
├── nginx
│   ├── Dockerfile
│   └── nginx.conf
└── web
    ├── Dockerfile
    ├── package.json
    └── server.js

2 directories, 7 files


```

[_compose.yaml_](compose.yaml)
```
  redis:
    image: 'redis:8.6.1-alpine'
    ports:
      - '6379:6379'
  web1:
    restart: on-failure
    build: ./web
    hostname: web1
    ports:
      - '5001:80'
  web2:
    restart: on-failure
    build: ./web
    hostname: web2
    ports:
      - '5002:80'
  nginx:
    build: ./nginx
    ports:
    - '8080:80'
    depends_on:
    - web1
    - web2
```

The compose file defines an application with four services `redis`, `nginx`, `web1` and `web2`.
When deploying the application, udocker compose maps port 80 of the nginx service container to port 8080 of the host as specified in the file.


> ℹ️ **_INFO_**  
> Redis runs on port 6379 by default. Make sure port 6379 on the host is not being used by another container, otherwise the port should be changed.

## Deploy with 

```shell
udocker compose
```

## Expected result

- Listing containers must show 4 containers:
- starting with ngnr- as below:

```shell
udocker ps
```

## Testing the app

- After the application starts, 
- navigate to `http://localhost:8080`
- in your web browser or run:

```shell
curl localhost:8080
# web1: Total number of visits is: 1
```

```shell
curl localhost:8080
# web1: Total number of visits is: 2
```

```shell
curl localhost:8080
# web2: Total number of visits is: 3
```


## Stop and remove the containers

```shell
# Ctrl+C to Stop services
udocker rm ngnr-xxxx
```

