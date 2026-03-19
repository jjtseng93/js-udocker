# Steps in general
- change redis image to redis:8.6.1-alpine
  * in docker-compose.yml
- remove
  * the whole postgres service
  * in docker-compose.yml
- add 
  * RUN npm install -g turbo 
  * before npx turbo
  * to Dockerfile
- add 
  * RUN apk add --no-cache build-base npm python3
  * to apps/api/v2/Dockerfile
- tweak the ports in .env and docker-compose.yml
- start postgresql in Termux (port 5432)

# Postgres
## Installing postgresql for cal.com in Termux
- pkg install postgresql
- initdb $PREFIX/var/lib/postgresql
- pg_ctl -D $PREFIX/var/lib/postgresql start
- psql postgres
- => Enters database postgres cmdline
- CREATE USER unicorn_user WITH PASSWORD 'magical_password';
- CREATE DATABASE calendso;
- => Exit
- psql calendso
- => Enters database calendso cmdline
- ALTER SCHEMA public OWNER TO unicorn_user;
