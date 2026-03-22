#!/bin/sh
service supervisor stop
service supervisor start
supervisorctl start ds:example
