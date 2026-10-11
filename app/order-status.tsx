"use client";
import { useState } from "react";
export default function OrderStatus({orderId,status}:{orderId:number;status:string}) { const [value,setValue]=useState(status),[error,setError]=useState("");
  async function advance(){const next:Record<string,string>={accepted:"preparing",preparing:"picked_up",picked_up:"delivered"}; const target=next[value]; if(value!=="placed"&&!target)return; const url=value==="placed"?`/api/orders/${orderId}/assign`:`/api/orders/${orderId}/status`;const body=value==="placed"?{partner_id:3}:{status:target};try{const res=await fetch(url,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await res.json();if(res.ok){setValue(value==="placed"?"accepted":target!);setError("")}else setError(data.error||"Update failed")}catch{setError("Could not reach the server.")}}
  return <span><button disabled={!({placed:1,accepted:1,preparing:1,picked_up:1}[value])} onClick={advance}>{value==="placed"?"Assign demo partner":"Advance demo status"}</button> <small>{value}{error&&` · ${error}`}</small></span>;
}
