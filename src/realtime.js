import {randomBytes} from "node:crypto";
import {WebSocketServer,WebSocket} from "ws";
export class RealtimeHub{
 constructor(httpServer){
  this.clients=new Set();this.tickets=new Map();
  this.wss=new WebSocketServer({noServer:true});
  this.wss.on("connection",socket=>{this.clients.add(socket);socket.send(JSON.stringify({type:"connected",at:new Date().toISOString()}));socket.on("close",()=>this.clients.delete(socket));});
  httpServer.on("upgrade",(request,socket,head)=>{
   const url=new URL(request.url||"/","http://localhost");
   if(url.pathname!=="/ws"){socket.destroy();return;}
   if(!this.consumeTicket(url.searchParams.get("ticket")||"")){socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");socket.destroy();return;}
   this.wss.handleUpgrade(request,socket,head,ws=>this.wss.emit("connection",ws,request));
  });
 }
 issueTicket(){this.prune();const id=randomBytes(24).toString("hex");this.tickets.set(id,Date.now()+60000);return id;}
 consumeTicket(id){this.prune();if(!id||!this.tickets.has(id))return false;const valid=this.tickets.get(id)>Date.now();this.tickets.delete(id);return valid;}
 prune(){const now=Date.now();for(const [id,until] of this.tickets)if(until<=now)this.tickets.delete(id);}
 publish(type,payload={}){const msg=JSON.stringify({type,payload,at:new Date().toISOString()});for(const socket of this.clients)if(socket.readyState===WebSocket.OPEN)socket.send(msg);}
 close(){this.tickets.clear();for(const client of this.clients)client.terminate();this.wss.close();}
}
