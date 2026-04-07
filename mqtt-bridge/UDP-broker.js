import { createSocket } from 'dgram';



const receiver = createSocket('udp4');
const PORT = 5000;

receiver.bind(PORT, () => {
  console.log(`UDP Receiver bound to port ${PORT}`);
});

receiver.on('message', (msg, rinfo) => {
  console.log(`Received: ${msg} from ${rinfo.address}:${rinfo.port}`);
});

receiver.on('error', (err) => {
  console.error(`Receiver error:\n${err.stack}`);
  receiver.close();
});
