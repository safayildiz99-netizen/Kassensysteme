export async function GET(){
  // The Vercel ZIP stores receipts on the player's device via localStorage.
  // Returning a non-success response keeps the already loaded local history.
  return Response.json({message:"Lokaler Bon-Speicher aktiv"},{status:501});
}

export async function POST(){
  return Response.json({ok:true,storage:"local"});
}
