"use client";

export type ManualJInputs={
  winterOutdoor:number;summerOutdoor:number;indoorHeat:number;indoorCool:number;summerGrains:number;
  ceilingHeight:number;
  wallR:number;ceilingR:number;floorR:number;doorR:number;
  windowU:number;windowShgc:number;northWindow:number;eastWindow:number;southWindow:number;westWindow:number;doorArea:number;shade:"none"|"some"|"heavy";
  ach50:number;ventilationCfm:number;occupants:number;internalWatts:number;
  ductLocation:"conditioned"|"encapsulated"|"basement"|"crawl"|"attic"|"garage";ductR:number;ductLeakage:number;
};

export type ManualJResult={
  heating:number;coolingSensible:number;coolingLatent:number;coolingTotal:number;recommendedTons:number;recommendedHeat:number;
  sqftPerTon:number;windowArea:number;ductPercent:number;requiredInputsComplete:boolean;
};

export const defaultManualJInputs:ManualJInputs={
  winterOutdoor:5,summerOutdoor:92,indoorHeat:70,indoorCool:75,summerGrains:35,
  ceilingHeight:9,
  wallR:21,ceilingR:49,floorR:30,doorR:5,
  windowU:.30,windowShgc:.25,northWindow:0,eastWindow:0,southWindow:0,westWindow:0,doorArea:40,shade:"some",
  ach50:3,ventilationCfm:0,occupants:4,internalWatts:1200,
  ductLocation:"conditioned",ductR:8,ductLeakage:5,
};

const round=(value:number)=>Math.max(0,Math.round(value));

export function calculateManualJ(input:ManualJInputs,project:{squareFeet:string;floors:string;foundation:string}):ManualJResult{
  const area=Math.max(0,Number(project.squareFeet)||0),floors=Math.max(1,Number(project.floors)||1),footprint=area/floors;
  const length=Math.sqrt(footprint||0),width=length;
  const perimeter=2*(length+width),volume=area*Math.max(7,input.ceilingHeight),wallGross=perimeter*Math.max(7,input.ceilingHeight)*floors;
  const windowArea=input.northWindow+input.eastWindow+input.southWindow+input.westWindow,wallNet=Math.max(0,wallGross-windowArea-input.doorArea);
  const heatDelta=Math.max(0,input.indoorHeat-input.winterOutdoor),coolDelta=Math.max(0,input.summerOutdoor-input.indoorCool);
  const safeR=(value:number)=>Math.max(1,value),airChanges=Math.max(0,input.ach50)/20,infiltrationCfm=volume*airChanges/60;
  const airCfm=infiltrationCfm+Math.max(0,input.ventilationCfm);

  const wallHeat=wallNet/safeR(input.wallR)*heatDelta,ceilingHeat=footprint/safeR(input.ceilingR)*heatDelta;
  const glassHeat=windowArea*Math.max(.05,input.windowU)*heatDelta,doorHeat=input.doorArea/safeR(input.doorR)*heatDelta;
  const foundation=project.foundation.toLowerCase();
  let foundationHeat=0;
  if(foundation.includes("slab"))foundationHeat=perimeter*.36*heatDelta;
  else if(foundation.includes("walkout"))foundationHeat=footprint/safeR(input.floorR)*(heatDelta*.55);
  else if(foundation.includes("basement"))foundationHeat=footprint/safeR(input.floorR)*Math.max(0,input.indoorHeat-50);
  else foundationHeat=footprint/safeR(input.floorR)*heatDelta;
  const airHeat=1.08*airCfm*heatDelta;
  const baseHeating=wallHeat+ceilingHeat+glassHeat+doorHeat+foundationHeat+airHeat;

  const wallCool=wallNet/safeR(input.wallR)*(coolDelta+8),ceilingCool=footprint/safeR(input.ceilingR)*(coolDelta+22);
  const glassConduction=windowArea*Math.max(.05,input.windowU)*coolDelta,doorCool=input.doorArea/safeR(input.doorR)*(coolDelta+8);
  const shadeFactor={none:1,some:.78,heavy:.55}[input.shade];
  const solar=(input.northWindow*45+input.eastWindow*164+input.southWindow*78+input.westWindow*164)*Math.max(.05,input.windowShgc)*shadeFactor;
  const airSensible=1.08*airCfm*coolDelta,peopleSensible=Math.max(1,input.occupants)*230,internalSensible=Math.max(0,input.internalWatts)*3.412;
  const baseSensible=wallCool+ceilingCool+glassConduction+doorCool+solar+airSensible+peopleSensible+internalSensible;
  const baseLatent=.68*airCfm*Math.max(0,input.summerGrains)+Math.max(1,input.occupants)*200;

  const locationFactor={conditioned:0,encapsulated:.04,basement:.07,crawl:.10,attic:.18,garage:.14}[input.ductLocation];
  const insulationFactor=Math.min(1.5,8/Math.max(2,input.ductR)),leakageFactor=1+Math.max(0,input.ductLeakage-5)*.03;
  const ductPercent=Math.min(.32,locationFactor*insulationFactor*leakageFactor);
  const heating=baseHeating*(1+ductPercent),coolingSensible=baseSensible*(1+ductPercent),coolingLatent=baseLatent*(1+ductPercent*.5),coolingTotal=coolingSensible+coolingLatent;
  const requiredInputsComplete=area>0&&windowArea>0&&input.ach50>0&&input.ceilingHeight>0;
  const recommendedTons=requiredInputsComplete&&coolingTotal>0?Math.max(1.5,Math.ceil(coolingTotal/6000)/2):0;
  const recommendedHeat=requiredInputsComplete&&heating>0?Math.ceil(heating/10000)*10000:0;
  return {heating:round(heating),coolingSensible:round(coolingSensible),coolingLatent:round(coolingLatent),coolingTotal:round(coolingTotal),recommendedTons,sqftPerTon:recommendedTons?round(area/recommendedTons):0,recommendedHeat,windowArea:round(windowArea),ductPercent:Math.round(ductPercent*100),requiredInputsComplete};
}

export default function ManualJStep({project,input,onChange,onSquareFeetChange}:{project:{squareFeet:string;floors:string;foundation:string};input:ManualJInputs;onChange:(next:ManualJInputs)=>void;onSquareFeetChange:(value:string)=>void}){
  const result=calculateManualJ(input,project),set=<K extends keyof ManualJInputs>(key:K,value:ManualJInputs[K])=>onChange({...input,[key]:value});
  const ready=result.requiredInputsComplete;
  return <div className="mj-shell">
    <div className="mj-note"><div><span>QUICK SIZING WORKSHEET</span><b>Northwest Missouri starting conditions are loaded.</b><small>Verify the exact city design temperatures and all plan values before final equipment selection.</small></div><button onClick={()=>onChange(defaultManualJInputs)}>Reset defaults</button></div>
    <div className="mj-layout">
      <div className="mj-form">
        <MJSection n="1" title="Design conditions" help="What temperatures and humidity must the system handle?">
          <div className="mj-grid four"><MJField label="Winter outdoor °F" value={input.winterOutdoor} setValue={v=>set("winterOutdoor",v)} help="Use the 99% heating design temperature."/><MJField label="Summer outdoor °F" value={input.summerOutdoor} setValue={v=>set("summerOutdoor",v)} help="Use the 1% cooling design dry-bulb."/><MJField label="Indoor heat °F" value={input.indoorHeat} setValue={v=>set("indoorHeat",v)}/><MJField label="Indoor cool °F" value={input.indoorCool} setValue={v=>set("indoorCool",v)}/><MJField label="Summer grains diff." value={input.summerGrains} setValue={v=>set("summerGrains",v)} help="Outdoor minus indoor moisture. 35 is a practical starting value; replace it with local design data."/></div>
        </MJSection>
        <MJSection n="2" title="House size" help="Enter the total conditioned square footage. Exterior length and width are not required.">
          <div className="mj-grid"><label className="mj-field">Total conditioned square footage<input type="number" min="0" step="1" value={project.squareFeet} placeholder="Example: 2400" onChange={e=>onSquareFeetChange(e.target.value)}/><small>Include only the living area served by this HVAC system. Exclude garages and other unconditioned spaces.</small></label><MJField label="Average ceiling height (ft)" value={input.ceilingHeight} setValue={v=>set("ceilingHeight",v)}/><div className="mj-readonly"><span>Floors</span><b>{project.floors}</b><small>Change this in House &amp; Project if needed.</small></div><div className="mj-readonly"><span>Foundation</span><b>{project.foundation}</b><small>Change this in House &amp; Project if needed.</small></div></div>
        </MJSection>
        <MJSection n="3" title="Insulation & exterior surfaces" help="Enter the installed assembly R-values from the plans—not just the batt or foam label.">
          <div className="mj-grid four"><MJField label="Exterior wall R" value={input.wallR} setValue={v=>set("wallR",v)}/><MJField label="Ceiling / roof R" value={input.ceilingR} setValue={v=>set("ceilingR",v)}/><MJField label="Floor / foundation R" value={input.floorR} setValue={v=>set("floorR",v)}/><MJField label="Exterior door R" value={input.doorR} setValue={v=>set("doorR",v)}/><MJField label="Total exterior door ft²" value={input.doorArea} setValue={v=>set("doorArea",v)}/></div>
        </MJSection>
        <MJSection n="4" title="Windows by direction" help="Total the glass area on each side of the house. Direction matters because afternoon sun can change the peak load.">
          <div className="mj-orientation"><MJField label="North glass ft²" value={input.northWindow} blankZero setValue={v=>set("northWindow",v)}/><MJField label="East glass ft²" value={input.eastWindow} blankZero setValue={v=>set("eastWindow",v)}/><MJField label="South glass ft²" value={input.southWindow} blankZero setValue={v=>set("southWindow",v)}/><MJField label="West glass ft²" value={input.westWindow} blankZero setValue={v=>set("westWindow",v)}/></div>
          <div className="mj-grid"><MJField label="Window U-factor" value={input.windowU} step="0.01" setValue={v=>set("windowU",v)} help="Lower is better. Find this on the window schedule or NFRC label."/><MJField label="Window SHGC" value={input.windowShgc} step="0.01" setValue={v=>set("windowShgc",v)} help="Solar Heat Gain Coefficient from the plans or NFRC label."/><label className="mj-select">Exterior shade / overhangs<select value={input.shade} onChange={e=>set("shade",e.target.value as ManualJInputs["shade"])}><option value="none">Little or none</option><option value="some">Some shade / normal overhangs</option><option value="heavy">Heavy permanent shade</option></select></label></div>
        </MJSection>
        <MJSection n="5" title="Air leakage, ventilation & people" help="A blower-door target is much more reliable than guessing tightness.">
          <div className="mj-grid"><MJField label="Blower door ACH50" value={input.ach50} step="0.1" setValue={v=>set("ach50",v)} help="Use the tested or specified air changes per hour at 50 Pa."/><MJField label="Dedicated fresh air (CFM)" value={input.ventilationCfm} blankZero setValue={v=>set("ventilationCfm",v)} help="ERV, HRV or outdoor-air duct flow. Do not include bath exhaust used only intermittently."/><MJField label="Design occupants" value={input.occupants} setValue={v=>set("occupants",v)} help="A common starting point is bedrooms plus one."/><MJField label="Lights & appliances (watts)" value={input.internalWatts} setValue={v=>set("internalWatts",v)} help="Coincident sensible gain during the cooling peak."/></div>
        </MJSection>
        <MJSection n="6" title="Duct system" help="Ducts outside the conditioned envelope can materially increase both heating and cooling load.">
          <div className="mj-grid"><label className="mj-select">Primary duct location<select value={input.ductLocation} onChange={e=>set("ductLocation",e.target.value as ManualJInputs["ductLocation"])}><option value="conditioned">Inside conditioned space</option><option value="encapsulated">Encapsulated attic / crawlspace</option><option value="basement">Unconditioned basement</option><option value="crawl">Vented crawlspace</option><option value="attic">Vented attic</option><option value="garage">Garage / other unconditioned space</option></select></label><MJField label="Duct insulation R" value={input.ductR} setValue={v=>set("ductR",v)}/><MJField label="Estimated duct leakage %" value={input.ductLeakage} step="0.5" setValue={v=>set("ductLeakage",v)} help="Use a leakage test when available. Enter percent of system airflow."/></div>
        </MJSection>
      </div>
      <aside className="mj-results">
        <span className={ready?"ready":"needs-data"}>{ready?"Sizing estimate ready":"Incomplete — add window areas"}</span>
        <h3>Whole-house design load</h3>
        <div className="mj-load heating"><small>HEATING</small><b>{result.heating.toLocaleString()}</b><em>BTU/h</em></div>
        <div className="mj-load cooling"><small>TOTAL COOLING</small><b>{result.coolingTotal.toLocaleString()}</b><em>BTU/h</em></div>
        <div className="mj-split"><span>Sensible <b>{result.coolingSensible.toLocaleString()}</b></span><span>Latent <b>{result.coolingLatent.toLocaleString()}</b></span></div>
        <div className="mj-recommend"><small>{ready?"START EQUIPMENT SELECTION NEAR":"EQUIPMENT SIZE WITHHELD"}</small><strong>{result.recommendedTons?`${result.recommendedTons} ton`:"—"}</strong><b>{result.recommendedHeat?`${result.recommendedHeat.toLocaleString()} BTU/h heat`:"Complete window areas before sizing"}</b></div>
        <dl><div><dt>Conditioned area</dt><dd>{Number(project.squareFeet||0).toLocaleString()} ft²</dd></div><div><dt>Glass counted</dt><dd>{result.windowArea} ft²</dd></div><div><dt>Duct load allowance</dt><dd>{result.ductPercent}%</dd></div><div><dt>Area per nominal ton</dt><dd>{result.sqftPerTon?`${result.sqftPerTon.toLocaleString()} ft²`:"—"}</dd></div></dl>
        <p className="mj-warning">The quick estimate uses total conditioned square footage, floor count, and ceiling height. Separate house dimensions are not needed.</p>
        <p className="mj-disclaimer"><b>Estimating aid:</b> this whole-house worksheet is not a certified Manual J report. Verify final loads in approved Manual J software, then match actual manufacturer capacity with Manual S. Room-by-room loads are still required for Manual D duct design.</p>
      </aside>
    </div>
  </div>;
}

function MJSection({n,title,help,children}:{n:string;title:string;help:string;children:React.ReactNode}){return <section className="mj-section"><header><span>{n}</span><div><b>{title}</b><small>{help}</small></div></header>{children}</section>}
function MJField({label,value,setValue,step="1",help,blankZero=false,placeholder}:{label:string;value:number;setValue:(value:number)=>void;step?:string;help?:string;blankZero?:boolean;placeholder?:string}){return <label className="mj-field">{label}<input type="number" min="0" step={step} value={blankZero&&value===0?"":value} placeholder={placeholder} onChange={e=>setValue(Number(e.target.value))}/>{help&&<small>{help}</small>}</label>}
