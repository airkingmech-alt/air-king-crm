import {SmsSendNow} from "@/components/sms-send-now";
import {useEffect,useState} from "react";
import {useInfiniteQuery,useQueryClient} from "@tanstack/react-query";
import {Link,useLocation,useSearch} from "wouter";
import {ArrowLeft,MessageSquare} from "lucide-react";
import {useAuth} from "@/context/auth-context";
import {crm} from "@/lib/crm-api";
import {Button} from "@/components/ui/button";
import {SmsComposer} from "@/components/sms-composer";
import {CustomerTextSearch} from "@/components/customer-text-search";
import {CustomerCommunications} from "@/pages/communications";

type Customer={id:string;name:string;is_primary:boolean;total_count:number};
type Cursor={at:string;key:string}|null;
type Message={key:string;id:string;direction:string;customer_id:string|null;body:string|null;status:string;provider_status:string|null;error:string|null;created_at:string;scheduled_at:string|null;read_at:string|null;ambiguous:boolean};
type Conversation={phone:string;last_at:string;preview:string;unread_count:number;customers:Customer[]};
const query=(values:Record<string,string>)=>new URLSearchParams(values).toString();
const when=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
const count=(customers:Customer[])=>Number(customers[0]?.total_count || 0);
function title(customers:Customer[]) {return count(customers)>1 ? "Shared phone · multiple customers" : customers[0]?.name || "No matching customer";}
export function textStatus(message:Message) {
  if(message.direction==="inbound") return message.status==="opted_out" ? "Opted out" : "Received";
  if(message.status==="pending") return "Queued · not delivered";
  if(message.status==="sending") return "Submitting · delivery unconfirmed";
  if(message.status==="unknown") return "Delivery unknown · do not resend";
  if(message.status==="failed") return "Failed";
  if(message.status==="cancelled") return "Cancelled";
  if(message.status==="delivered" || message.provider_status==="delivered" || message.provider_status==="read") return "Delivered";
  if(["queued","scheduled","routed","accepted"].includes(message.provider_status || "")) return "Accepted by provider · not delivered";
  return message.status==="sent" ? "Sent · delivery unconfirmed" : message.status;
}
export default function TextMessages() {
  const {profile}=useAuth();
  // Remount on account changes so drafts, selection and cached pages cannot cross tenants.
  return <Messages key={`${profile?.company_id}:${profile?.id}`} company={profile?.company_id || ""} canSendNow={["owner","admin"].includes(profile?.role || "")}/>;
}
function Messages({company,canSendNow}:{company:string;canSendNow:boolean}) {
  const [,navigate]=useLocation(),search=useSearch();
  const selected=new URLSearchParams(search).get("phone") || "";
  const cache=useQueryClient();
  const [notice,setNotice]=useState("");
  const [marking,setMarking]=useState(false);
  const [starting,setStarting]=useState(false);
  const [newCustomer,setNewCustomer]=useState("");
  useEffect(()=>{setStarting(false);setNewCustomer("");},[selected]);
  const list=useInfiniteQuery({queryKey:["text-conversations",company],initialPageParam:null as Cursor,
    queryFn:({pageParam})=>crm("crm/text-messages"+(pageParam ? "?"+query({before:JSON.stringify(pageParam)}) : "")),
    getNextPageParam:last=>last.next || undefined,refetchInterval:15000});
  const history=useInfiniteQuery({queryKey:["text-history",company,selected],enabled:!!selected,initialPageParam:null as Cursor,
    queryFn:({pageParam})=>crm("crm/text-messages/history?"+query({phone:selected,...(pageParam?{before:JSON.stringify(pageParam)}:{})})),
    getNextPageParam:last=>last.next || undefined,refetchInterval:15000});
  const conversations:Conversation[]=Array.from(new Map((list.data?.pages.flatMap(p=>p.items) || []).map((c:Conversation)=>[c.phone,c])).values()) as Conversation[];
  const messages:Message[]=Array.from(new Map((history.data?.pages.flatMap(p=>p.items) || []).map((m:Message)=>[m.key,m])).values()) as Message[];
  messages.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.key.localeCompare(b.key));
  const customers:Customer[]=history.data?.pages[0]?.customers || [];
  const shared=count(customers)>1;
  const unread=messages.filter(m=>m.direction==="inbound"&&!m.read_at);
  const refresh=async()=>{await Promise.all([cache.invalidateQueries({queryKey:["text-history",company]}),cache.invalidateQueries({queryKey:["text-conversations",company]}),cache.invalidateQueries({queryKey:["sms-replies"]})]);};
  return <div className="space-y-4 min-w-0">
    <header className="flex flex-wrap items-start justify-between gap-2"><div><h1 className="text-2xl font-bold">Text Messages</h1><p className="text-sm text-muted-foreground">Sent texts and replies, together by phone.</p></div><div className="flex items-center gap-3"><Button onClick={()=>{setStarting(true);setNewCustomer("");}}>Start a text</Button><Link href="/replies" className="text-sm underline">Reply history</Link></div></header>
    {starting && <section aria-label="Start a text" className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Start a text</h2><Button variant="ghost" onClick={()=>setStarting(false)}>Close</Button></div>
      <p className="text-sm text-muted-foreground">Choose a customer, including someone with no previous messages. Confirm their primary phone and service-text permission before sending.</p>
      <CustomerTextSearch value={newCustomer} onChange={setNewCustomer}/>
      {newCustomer && <>
        <p className="text-sm break-words">Customer record: {newCustomer} · <Link className="underline" href={`/customers/${encodeURIComponent(newCustomer)}`}>Review contact details</Link></p>
        <CustomerCommunications key={newCustomer} customerId={newCustomer} onQueued={()=>{void refresh();}}/>
      </>}
    </section>}
    {!starting && <>
    <div className="grid md:grid-cols-[minmax(240px,320px)_minmax(0,1fr)] gap-4 items-start">
      <section aria-label="Conversations" className={`border rounded-xl overflow-hidden min-w-0 ${selected?"hidden md:block":""}`}>
        <h2 className="p-3 font-semibold border-b">Conversations</h2>
        {list.isLoading && <p role="status" className="p-4">Loading conversations…</p>}
        {list.error && <div role="alert" className="p-3 space-y-2"><p>Unable to load conversations. {list.error.message}</p><Button variant="outline" onClick={()=>list.refetch()}>Retry conversations</Button></div>}
        {!list.isLoading&&!list.error&&!conversations.length&&<p className="p-4 text-sm text-muted-foreground">No text messages yet. Start a text from a customer’s Timeline.</p>}
        {conversations.map(c=><button key={c.phone} aria-current={selected===c.phone?"true":undefined} onClick={()=>{setNotice("");navigate("/text-messages?"+query({phone:c.phone}));}}
          className={`w-full text-left p-3 border-b space-y-1 hover:bg-muted focus-visible:outline focus-visible:outline-2 ${selected===c.phone?"bg-muted":""}`}>
          <span className="flex justify-between gap-2"><span className="font-medium break-words">{title(c.customers)}</span>{Number(c.unread_count)>0&&<span className="rounded-full bg-blue-700 text-white px-2 text-xs py-1 shrink-0" aria-label={`${c.unread_count} unread replies`}>{c.unread_count}</span>}</span>
          <span className="block text-sm">{c.phone}</span><span className="block truncate text-sm text-muted-foreground">{c.preview || "No text content"}</span>
          <time className="block text-xs text-muted-foreground" dateTime={c.last_at}>{when(c.last_at)}</time>
        </button>)}
        {list.hasNextPage&&<Button variant="ghost" className="w-full" disabled={list.isFetchingNextPage} onClick={()=>list.fetchNextPage()}>Load more conversations</Button>}
      </section>
      {!selected?<section className="hidden md:flex min-h-80 border rounded-xl items-center justify-center text-muted-foreground gap-2"><MessageSquare aria-hidden="true"/><p>Select a conversation to view messages.</p></section>:
        <section aria-label="Selected conversation" className="min-w-0 border rounded-xl p-3 sm:p-4 space-y-4">
          <Button variant="ghost" className="md:hidden" onClick={()=>navigate("/text-messages?phone=")}><ArrowLeft className="h-4 w-4 mr-2"/>All conversations</Button>
          <header className="space-y-1"><h2 className="font-semibold text-lg break-words">{title(customers)}</h2><p className="break-all">{selected}</p>
            {customers.map(c=><Link key={c.id} href={`/customers/${encodeURIComponent(c.id)}`} className="inline-block mr-3 text-sm underline">{c.name}</Link>)}
            {count(customers)>21&&<p className="text-sm">Showing 21 of {count(customers)} matching customers.</p>}
          </header>
          {history.isLoading&&<p role="status">Loading messages…</p>}
          {history.error&&<div role="alert"><p>Unable to load messages. {history.error.message}</p><Button variant="outline" onClick={()=>history.refetch()}>Retry messages</Button></div>}
          {history.data&&!history.error&&<>
            {shared&&<p className="rounded-md bg-amber-50 text-amber-950 p-3 text-sm">Multiple customers share this phone. Choose the customer for your new outgoing text below. Existing messages retain their original links; unassigned replies remain unassigned.</p>}
            {history.hasNextPage&&<Button variant="outline" disabled={history.isFetchingNextPage} onClick={()=>history.fetchNextPage()}>Load older messages</Button>}
            {!messages.length&&<p className="text-muted-foreground">No messages in this conversation.</p>}
            <ol aria-label="Message history" className="space-y-3">
              {messages.map(m=><li key={m.key} className={`flex ${m.direction==="outbound"?"justify-end":"justify-start"}`}>
                <article className={`max-w-[92%] sm:max-w-[85%] rounded-xl p-3 min-w-0 ${m.direction==="outbound"?"bg-blue-50 text-blue-950 border border-blue-200":"bg-muted border"}`}>
                  <p className="text-xs font-semibold mb-1">{m.direction==="outbound"?"Office → customer":"Customer → office"}{m.direction==="inbound"&&!m.read_at?" · Unread":""}</p>
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{m.body || (m.status==="opted_out"?"Provider reported an opt-out.":"No text supplied. Attachments are not displayed.")}</p>
                  <p className="text-xs mt-2">{textStatus(m)} · <time dateTime={m.created_at}>{when(m.created_at)}</time></p>
                  {m.status==="pending"&&m.scheduled_at&&<p className="text-xs">Scheduled: {when(m.scheduled_at)}</p>}
                  {canSendNow&&m.direction==="outbound"&&m.status==="pending"&&<SmsSendNow key={m.id} id={m.id} recipient={selected} onUpdated={()=>{void refresh();}}/>}
                  {m.error&&<p className="text-xs mt-1">{m.error}</p>}
                  {m.ambiguous&&<p className="text-xs mt-1">Received with multiple customer matches; not assigned.</p>}
                  {m.customer_id&&<Link className="text-xs underline" href={`/customers/${encodeURIComponent(m.customer_id)}`}>Original customer record</Link>}
                </article>
              </li>)}
            </ol>
            {!!unread.length&&<Button variant="outline" disabled={marking} onClick={async()=>{setMarking(true);setNotice("");try{
              for(const m of unread) await crm(`crm/replies/${m.id}/read`,"POST",{});
            }catch(e:any){setNotice(e.message);}finally{await refresh();setMarking(false);}}}>Mark displayed replies read ({unread.length})</Button>}
            <ConversationReply key={`${company}:${selected}`} customers={customers} recipient={selected} onQueued={()=>{void refresh();}}/>
          </>}
          {notice&&<p role="alert">{notice}</p>}
        </section>}
    </div>
    </>}
  </div>;
}

// Remount for each conversation/account. Never infer a shared phone's identity
// from its latest message, and never persist a selected customer across threads.
function ConversationReply({customers,recipient,onQueued}:{customers:Customer[];recipient:string;onQueued:()=>void}) {
  const [chosen,setChosen]=useState("");
  const primary=customers.filter(c=>c.is_primary);
  const shared=count(customers)>1;
  const customer=primary.find(c=>c.id===(shared ? chosen : customers.length===1 ? customers[0].id : ""));
  useEffect(()=>{if(chosen&&!customers.some(c=>c.id===chosen&&c.is_primary))setChosen("");},[customers,chosen]);
  if(!primary.length) return <p className="rounded-md bg-amber-50 text-amber-950 p-3 text-sm">{!customers.length
    ? "No current customer matches this phone. Review the customer records before replying."
    : "This is an additional contact phone. Replies here require a matching primary contact."}</p>;
  return <div className="space-y-3 min-w-0">
    {shared&&<div className="space-y-2">
      <label htmlFor="reply-customer" className="block font-medium">Reply as this customer</label>
      <select id="reply-customer" className="block w-full min-w-0 rounded-md border bg-background p-2 text-sm" value={customer?.id || ""} onChange={e=>setChosen(e.target.value)}>
        <option value="">Choose a customer…</option>
        {primary.map(c=><option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
      </select>
      <p className="text-xs text-muted-foreground">Only matching primary contacts are listed. Choose carefully: the text goes to the shared phone. Switching customers clears unsent drafts; requests awaiting confirmation stay with their original customer.</p>
    </div>}
    {customer&&<>
      <p className="text-sm break-words">Reply for <strong>{customer.name}</strong> ({customer.id}) · <span className="break-all">{recipient}</span></p>
      <SmsComposer key={customer.id} customerId={customer.id} conversationPhone={recipient} onQueued={onQueued}/>
    </>}
  </div>;
}
