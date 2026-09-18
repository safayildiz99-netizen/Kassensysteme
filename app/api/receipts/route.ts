import { env } from "cloudflare:workers";

async function ensureSchema(){
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, barcode TEXT NOT NULL UNIQUE, receipt_number TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS receipts_created_at_idx ON receipts (created_at DESC)"),
  ]);
}

export async function GET(){
  await ensureSchema();
  const result=await env.DB.prepare("SELECT data FROM receipts ORDER BY created_at DESC LIMIT 500").all<{data:string}>();
  const receipts=result.results.flatMap(row=>{try{return [JSON.parse(row.data)]}catch{return []}});
  return Response.json({receipts});
}

export async function POST(request:Request){
  await ensureSchema();
  const receipt=await request.json() as {id?:string;barcode?:string;number?:string;kind?:string;createdAt?:number};
  if(!receipt.id||!receipt.barcode||!receipt.number)return Response.json({error:"Ungültiger Bon"},{status:400});
  await env.DB.prepare("INSERT INTO receipts (id, barcode, receipt_number, kind, created_at, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET barcode=excluded.barcode, receipt_number=excluded.receipt_number, kind=excluded.kind, created_at=excluded.created_at, data=excluded.data")
    .bind(receipt.id,receipt.barcode,receipt.number,receipt.kind||"sale",receipt.createdAt||Date.now(),JSON.stringify(receipt)).run();
  return Response.json({ok:true});
}
