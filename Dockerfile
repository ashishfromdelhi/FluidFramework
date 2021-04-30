FROM node:14 AS base

RUN apt update
RUN apt-get -y install vim
WORKDIR /app

ENV error__endpoint https://25f5c231660f474fb85fb4daeb070029:3301d25c7ed9434688e4f5bd998b9739@sentry.wu2.prague.office-int.com/2

ENV fluid__webpack__bearerSecret Air07cdhm0FdTQAkLnv9yaR9KyMy2YwP

ENV fluid__webpack__fluidHost https://www.r11s-wu2.prague.office-int.com

ENV fluid__webpack__npm https://pragueauspkn-3873244262.azureedge.net

ENV fluid__webpack__tenantId fluid

ENV fluid__webpack__tenantSecret kugsxew39jx2wh163igxrglphy2kcws3

ENV intelligence__translation__key 75ed7b5c411649eb895e03dae6a6f873

ENV intelligence__translation__prod__key bd099a1e38724333b253fcff7523f76a

ENV login__microsoft__clientId 3d642166-9884-4463-8248-78961b8c1300

ENV login__microsoft__secret EQPVXbfBiRr4R26.r4.hCdR8BiUR-~8~LN

ENV login__accounts '[{"username": "test", "password": "mRTvhfDTE3FYbVc"}]'

ENV APPINSIGHTS_INSTRUMENTATIONKEY 8bdf0a93-fb15-4193-b68e-c0582087a341

ENV login__odsp__test__accounts '{"user0@a830edad9050849829J20060312.onmicrosoft.com": "Boka0881"}'

RUN npm update -g

COPY . .

RUN npm install

RUN npm run postinstall

RUN npm run build:ci

WORKDIR /app/packages/test/test-service-load

EXPOSE 9320

# COPY odspDocumentDeltaConnection.js /app/node_modules/\@fluidframework/odsp-driver/dist/
