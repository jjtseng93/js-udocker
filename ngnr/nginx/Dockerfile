FROM nginx:1.21.6
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN rm /var/log/nginx/error.log
RUN rm /var/log/nginx/access.log
