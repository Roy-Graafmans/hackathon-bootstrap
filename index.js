const openpgp = require('openpgp');
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
	app.listen(4080, "192.168.43.23");
	app.engine('.html', express_handlebars({ layout: false, extname: '.html' }));
	app.set('view engine', '.html');
	app.use(express.urlencoded({ limit: '16mb', extended: true }));
	app.use(express.json({ limit: '16mb', extended: true }));
	app.use(express_session({ secret: 'd8ca01bd-d585-4dd8-8a16-a7195d7fc2a8', name: 'Hackathon', proxy: true, resave: true, saveUninitialized: true }));

	openpgp.initWorker({ path: 'openpgp.worker.js' });

	let key = {}, identity = {};

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

			this.time = () => {
				let now = new Date();
				return now.toISOString();
			};

			this.arraytohex = (array) => {
				return openpgp.util.Uint8Array_to_hex(array);
			};

			this.hextoarray = (hex) => {
				return openpgp.util.hex_to_Uint8Array(hex);
			};

			this.hextokey = (hex) => {
				let bytes = this.hextoarray(hex);
				return openpgp.key.read(bytes).keys;
			};

			this.keytohex = (key, public_only) => {
				let bytes;
				if (public_only) {
					bytes = key.toPublic().toPacketlist().write();
				} else {
					bytes = key.toPacketlist().write();
				};
				return this.arraytohex(bytes);
			};

			this.objecttohex = (object) => {
				return neon.u.str2hexstring(JSON.stringify(object));
			};

			this.sign = async (message, key, identity) => {
				if (key) {
					try {
						let privateKey = await openpgp.key.readArmored(identity.key.privateKeyArmored);
						let decrypted = await privateKey.keys[0].decrypt(identity.uuid);
						if (!decrypted) { return false; };
						let options = {
							message: openpgp.cleartext.fromText(message),
							publicKeys: this.hextokey(identity.public),
							privateKeys: [ privateKey.keys[0] ],
							detached: true,
							armor: true
						};
						let attachment = await openpgp.sign(options);
						let signature = this.objecttohex({
							"signature": this.objecttohex(attachment),
							"fingerprint": identity.fingerprint
						});
						return signature;
					} catch (error) {
						console.error(error);
						return false;
					};
				};
				return false;
			};

			this.is = {
				null: (value) => {
					return value === null;
				},
				undefined: (value) => {
					return typeof value === 'undefined';
				},
				string: (value) => {
					return typeof value === 'string' || value instanceof String;
				},
				array: (value) => {
					return Array.isArray(value);
				},
				object: (value) => {
					return value && typeof value === 'object' && value.constructor === Object;
				},
				boolean: (value) => {
					return typeof value === 'boolean';
				},
				error: (value) => {
					return value instanceof Error && typeof value.message !== 'undefined';
				},
				json: (value) => {
					try {
						JSON.parse(value);
					} catch (error) {
						return false;
					};
					return true;
				}
			};
		};
	};

	let service = new Service();

	app.ws('/socket/', (ws, request) => {
		let { timer, uuid, data, session } = service.start(request);
		try {
			service.finalize(timer, uuid, () => {
				console.log("WebSocket user is connected");
				let update = JSON.stringify( {
					"from": "System Notification",
					"uuid": uuid,
					"time": service.time(),
					"message": "Connected to the Hackathon Message Server"
				} );
				ws.send(update);
			});

			ws.on('message', async function (message) {
				try {
					if (service.is.json(message)) {
						let event = JSON.parse(message);
						if (event.hasOwnProperty("message")) {
							let socket = Socket.getWss('/socket/');
							let signature = await service.sign(event.message.message, key[uuid], identity[uuid]) || "Message has no signature";
							let update = JSON.stringify( {
								"from": event.message.username,
								"uuid": uuid,
								"time": service.time(),
								"message": event.message.message,
								"signature": signature
							} );
							socket.clients.forEach(function (client) {
								client.send(update);
							});
						};

						if (event.hasOwnProperty("pgp")) {
							if (event.pgp.task == "create") {
								if (!key[uuid]) {
									console.log("New private key was requested");
									let options = {
										userIds: [ { "name": uuid } ],
										curve: "ed25519",
										passphrase: uuid
									};
									key[uuid] = await openpgp.generateKey(options);
									identity[uuid] = {
										"key": key[uuid],
										"public": service.keytohex(key[uuid].key, true),
										"private": service.keytohex(key[uuid].key, false),
										"fingerprint": service.arraytohex(key[uuid].key.primaryKey.fingerprint),
										"uuid": uuid
									};
									let update = JSON.stringify( {
										"from": "System Notification",
										"uuid": uuid,
										"time": service.time(),
										"message": "New PGP private key has been generated with fingerprint " + identity[uuid].fingerprint
									} );
									ws.send(update);
								} else {
									console.log("Private key was requested but user already has a private key");
									let update = JSON.stringify( {
										"from": "System Notification",
										"uuid": uuid,
										"time": service.time(),
										"message": "You already have a private key"
									} );
									ws.send(update);
								};
							} else if (event.pgp.task == "sign") {
								console.log("Signing message with PGP key");
								let update = JSON.stringify( {
									"from": "System Notification",
									"uuid": uuid,
									"time": service.time(),
									"message": "Message has been signed with PGP private key"
								} );
								ws.send(update);
							};
						};
					} else {
						console.log(message);
					};
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
