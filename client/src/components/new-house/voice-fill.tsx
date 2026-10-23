"use client";

import { useMemo, useRef, useState } from "react";

export type VoiceChange={field:string;label:string;display:string;value:string|number|boolean;data?:Record<string,string|number|boolean>};
type SpeechResult={0?:{transcript:string};length:number};
type SpeechEvent={results:ArrayLike<SpeechResult>};
type SpeechRecognitionLike={lang:string;continuous:boolean;interimResults:boolean;start:()=>void;stop:()=>void;onresult:((event:SpeechEvent)=>void)|null;onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null};
type SpeechCtor=new()=>SpeechRecognitionLike;

export default function VoiceFill({label="Voice Fill",interpret,onApply}:{label?:string;interpret:(transcript:string)=>VoiceChange[];onApply:(changes:VoiceChange[],transcript:string)=>void}){
  const [open,setOpen]=useState(false),[listening,setListening]=useState(false),[transcript,setTranscript]=useState(""),[message,setMessage]=useState("");
  const recognitionRef=useRef<SpeechRecognitionLike|null>(null),resultRef=useRef("");
  const changes=useMemo(()=>interpret(transcript),[interpret,transcript]);
  const start=()=>{
    setMessage("");setTranscript("");resultRef.current="";
    const speechWindow=window as Window&{SpeechRecognition?:SpeechCtor;webkitSpeechRecognition?:SpeechCtor};
    const Ctor=speechWindow.SpeechRecognition??speechWindow.webkitSpeechRecognition;
    if(!Ctor){setOpen(true);setMessage("Voice recognition is not available in this browser. Use the microphone on your phone keyboard to dictate into the transcript box.");return;}
    const recognition=new Ctor();recognitionRef.current=recognition;recognition.lang="en-US";recognition.continuous=false;recognition.interimResults=false;
    recognition.onresult=event=>{const text=Array.from(event.results).map(result=>result[0]?.transcript??"").join(" ").trim();resultRef.current=text;setTranscript(text);};
    recognition.onerror=event=>{setListening(false);setMessage(event.error==="not-allowed"?"Microphone access was not allowed. You can still type or dictate into the transcript box.":"I could not hear that clearly. Try again or edit the transcript.");setOpen(true);};
    recognition.onend=()=>{setListening(false);setTranscript(resultRef.current);setOpen(true);};
    setListening(true);recognition.start();
  };
  const close=()=>{recognitionRef.current?.stop();setListening(false);setOpen(false)};
  const apply=()=>{onApply(changes,transcript);setOpen(false);setMessage("")};
  return <>
    <button type="button" className={`voice-fill-button ${listening?"listening":""}`} onClick={listening?()=>recognitionRef.current?.stop():start}><span aria-hidden="true">{listening?"■":"●"}</span>{listening?" Stop Listening":` ${label}`}</button>
    {open&&<div className="voice-fill-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)close()}}><section className="voice-fill-modal" role="dialog" aria-modal="true" aria-label="Review voice-filled quote fields"><header><div><span>VOICE ASSISTED ENTRY</span><h2>Review Before Applying</h2><p>Confirm what the builder recognized. Spoken prices will be applied as shown.</p></div><button aria-label="Close voice review" onClick={close}>×</button></header><label className="voice-transcript"><span>TRANSCRIPT</span><textarea value={transcript} onChange={event=>setTranscript(event.target.value)} placeholder="Example: New house, 2,400 square feet, 18 supply runs, 2 returns, high-efficiency furnace with 60 feet of PVC…"/></label>{message&&<p className="voice-message">{message}</p>}<div className="voice-recognized"><div><b>{changes.length}</b><span> recognized change{changes.length===1?"":"s"}</span></div>{changes.length?<ul>{changes.map((change,index)=><li key={`${change.field}-${index}`}><span>{change.label}</span><strong>{change.display}</strong></li>)}</ul>:<p>Nothing has been recognized yet. Edit the transcript or try speaking again with quantities and item names.</p>}</div><footer><button onClick={start}>↻ Record Again</button><button className="voice-apply" disabled={!changes.length} onClick={apply}>Apply {changes.length} Change{changes.length===1?"":"s"} →</button></footer></section></div>}
  </>;
}
