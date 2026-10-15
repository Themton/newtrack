import worker, { jtRequest } from './cloudflare-worker.js';
export default worker;
import { WorkerEntrypoint } from 'cloudflare:workers';
// Private RPC entrypoint: this export has no public HTTP route.
// Only allow the CRM namespace; never return J&T credentials.
export class JtCrmBridge extends WorkerEntrypoint {
  async ready(vip) {
    const suffix={VIP8530310123:'23',VIP8530310124:'24'}[vip];
    return !!(this.env.JT_API_BASE==='https://ylopenapi.jtexpress.co.th' && suffix && ['API_ACCOUNT','PRIVATE_KEY','BUSINESS_PASSWORD'].every(k=>this.env[`JT_${suffix}_${k}`]));
  }
  async request(path, body) {
    const paths=['/webopenplatformapi/api/order/addOrder','/webopenplatformapi/api/order/cancelOrder','/webopenplatformapi/api/order/printOrder','/webopenplatformapi/api/logistics/trace'];
    if(!paths.includes(path)||!body||!/^MTCRM-[a-f0-9]{40}$/.test(body.txlogisticId||''))throw new Error('Invalid CRM J&T request');
    if(!await this.ready(body.customerCode))throw new Error('J&T account not configured');
    if(JSON.stringify(body).length>32768)throw new Error('Request too large');
    return jtRequest(path,body,this.env);
  }
}
