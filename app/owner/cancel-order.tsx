"use client";
import {useState} from "react";
export default function CancelOrder({orderId}:{orderId:number}){const [message,setMessage]=useState("");async function cancel(){const r=await fetch(`/api/orders/${orderId}/status`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status:"cancelled"})});const d=await r.json();if(r.ok)location.reload();else setMessage(d.error||"Cancellation failed.");}return <span><button className="secondary" onClick={cancel}>Cancel before pickup</button>{message&&<small>{message}</small>}</span>}
