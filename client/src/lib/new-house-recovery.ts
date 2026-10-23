export type TakeoffRecovery={version:1;customerId:string;propertyId:string;state:Record<string,unknown>};
export const takeoffRecoveryKey=(company:string,user:string,quote?:string)=>`airking:new-house:v1:${encodeURIComponent(company)}:${encodeURIComponent(user)}:${encodeURIComponent(quote||"new")}`;
export function readTakeoffRecovery(storage:Pick<Storage,"getItem">,key:string):TakeoffRecovery|null{
  try{
    const raw=storage.getItem(key);if(!raw||raw.length>200000)return null;
    const value=JSON.parse(raw);
    return value?.version===1&&typeof value.customerId==="string"&&typeof value.propertyId==="string"&&value.state&&typeof value.state==="object"&&!Array.isArray(value.state)?value:null;
  }catch{return null;}
}
