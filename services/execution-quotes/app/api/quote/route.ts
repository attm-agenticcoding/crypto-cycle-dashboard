import {getQuote, instruments} from '../../../lib/quotes.mjs';
const headers={'Access-Control-Allow-Origin':'https://attm-agenticcoding.github.io','Access-Control-Allow-Methods':'GET, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
export function OPTIONS(){return new Response(null,{status:204,headers});}
export async function GET(request:Request){
  const id=new URL(request.url).searchParams.get('instrument')||'';
  if(!Object.hasOwn(instruments,id))return Response.json({error:'Unsupported instrument'},{status:400,headers});
  try {
    const referenceCache=(globalThis as any).caches?.default||null;
    return Response.json(await getQuote(id,{referenceCache}),{headers});
  }catch(error){console.error('Quote request failed:', error instanceof Error ? error.message : 'unknown');return Response.json({error:'Market data unavailable'},{status:503,headers});}
}
