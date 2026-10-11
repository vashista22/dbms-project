"use client";
import {useState} from "react";
export default function AssignOrder({orderId}:{orderId:number}){const [message,setMessage]=useState("");async function assign(){const r=await fetch(`/api/orders/${orderId}/assign`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({partner_id:3})});const d=await r.json();if(r.ok)location.reload();else setMessage(d.error||"Assignment failed.");}return <span><button onClick={assign}>Assign demo partner</button>{message&&<small>{message}</small>}</span>}
