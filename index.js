const express = require('express');
const express_session = require('express-session');
const express_handlebars = require('express-handlebars');
const fetch = require('node-fetch');
const abort = require('abort-controller');
const neon = require("@cityofzion/neon-js");
const bignumber = require("bignumber.js");
const uuid = require('uuid/v5');
const fs = require('fs');
const cluster = require('cluster');
const util = require('util');

const init = async () => {
	console.log('Starting server');
	await server();
};

const server = async () => {
	let app = express();
	let Socket = require('express-ws')(app);
	app.listen(4080, "127.0.0.1");
	app.engine('.html', express_handlebars({ layout: false, extname: '.html' }));
	app.set('view engine', '.html');
	app.use(express.urlencoded({ limit: '16mb', extended: true }));
	app.use(express.json({ limit: '16mb', extended: true }));
	app.use(express_session({ secret: 'd8ca01bd-d585-4dd8-8a16-a7195d7fc2a8', name: 'Hackathon', proxy: true, resave: true, saveUninitialized: true }));

	class Service {
		constructor() {
			this.UUID = () => {
				try {
					let namespace = uuid('org.neoblocks.common', uuid.DNS);
					return uuid(JSON.stringify(process.hrtime()), namespace);
				} catch (error) {
					return false;
				};
			};

			this.Timer = class Timer {
				constructor () {
					let timestamp = process.hrtime();
					this.start = () => { timestamp = process.hrtime(); };
					this.reset = () => { timestamp = process.hrtime(); };
					this.stop = () => {
						timestamp = process.hrtime(timestamp);
						return timestamp[0]+(timestamp[1]/1000000000);
					};
				};
			};

			this.start = (request) => {
				let timer = new service.Timer(), uuid = service.UUID(), session = request.session;
				console.log("Starting request", uuid);
				return { "timer": timer, "uuid": uuid, "data": {}, "session": session };
			};

			this.finalize = (timer, uuid, render) => {
				let time = timer.stop();
				console.log("Request completed", uuid, time, "seconds");
				render();
			};
		};
	};

	let service = new Service();

	app.ws('/socket/', (ws, request) => {
		let { timer, uuid, data, session } = service.start(request);
		try {
			service.finalize(timer, uuid, () => {
				console.log("WebSocket user is connected");
				let today = new Date();
				let time = (today.getHours()+":"+today.getMinutes()+":"+today.getSeconds());
				let update = JSON.stringify(
					{
						"from": "Core System",
						"uuid": uuid,
						"time": time,
						"message": "Connected to the Hackathon Message Server"
					}
				);
				ws.send(update);
			});

			ws.on('message', function (message) {
				try {
					let event = JSON.parse(message);
					let socket = Socket.getWss('/socket/');
					let today = new Date();
					let time = (today.getHours()+":"+today.getMinutes()+":"+today.getSeconds());
					let update = JSON.stringify(
						{
							"from": event.username,
							"uuid": uuid,
							"time": time,
							"message": event.message
						}
					);
					socket.clients.forEach(function (client) {
						client.send(update);
					});
				} catch (error) {
					console.error(error);
				}
			});
		} catch (error) {
			console.error(error);
		};
	});

	app.get("/", async function(request, response) {
		let { timer, uuid, data, session } = service.start(request);
		try {
			service.finalize(timer, uuid, () => {
				response.render('index', { "data": data });
			});
		} catch (error) {
			console.error(error);
		};
	});
};

init();
