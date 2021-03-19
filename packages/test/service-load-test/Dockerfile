FROM node:buster AS base

RUN apt update
RUN apt-get -y install vim
WORKDIR /app

COPY . .

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

ENV login__odsp__test__accounts '{"user0@a830edad9050849829E21021220.onmicrosoft.com":"Lubo6708","user0@a830edad9050849830E21012616.onmicrosoft.com":"Qutu7891","user0@a830edad9050849829J20060312.onmicrosoft.com":"Boka0880","user1@a830edad9050849829J20060312.onmicrosoft.com":"Boka0881","user2@a830edad9050849829J20060312.onmicrosoft.com":"Boka0882","user3@a830edad9050849829J20060312.onmicrosoft.com":"Boka0883","user4@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user5@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user6@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user7@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user8@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user9@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user10@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user11@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user12@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user13@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user14@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user15@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user16@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user17@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user18@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user19@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user20@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user21@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user22@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user23@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user24@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user25@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user26@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user27@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user28@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user29@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user30@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user31@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user32@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user33@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user34@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user35@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user36@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user37@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user38@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234","user39@a830edad9050849829J20060312.onmicrosoft.com":"Hpop1234"}'

RUN npm install

RUN npm install socket.io-client@2.1.1

RUN npm run build

WORKDIR /app