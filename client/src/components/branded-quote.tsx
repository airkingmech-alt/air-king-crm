import airKingLogo from "@/assets/air-king-logo.jpg";
import "./branded-quote.css";

export function QuoteHeader({ number, title, customerName, status, createdAt }: {
  number: string; title: string; customerName: string; status: string; createdAt?: string;
}) {
  const label = ({ Won: "Accepted", Lost: "Declined", "Quote Sent": "Sent" } as Record<string, string>)[status] || status;
  const date = createdAt ? new Date(createdAt.includes("T") ? createdAt : createdAt + "T12:00:00") : null;
  return <header className="quote-header rounded-xl border bg-card text-card-foreground overflow-hidden">
    <div className="h-1.5 bg-[#b7192f]" />
    <div className="p-6 sm:p-8">
      <div className="flex flex-col sm:flex-row justify-between gap-6">
        <div>
          <img src={airKingLogo} alt="Air King logo" className="h-24 w-40 object-contain bg-white rounded-sm" />
          <p className="mt-2 font-semibold text-sm">Mechanical Services LLC</p>
          <address className="mt-2 text-xs not-italic leading-6 text-muted-foreground">
            1820 NE 288th St · Turney, MO 64493<br />
            <a href="tel:+18165196067" className="font-semibold text-foreground">(816) 519-6067</a><br />
            <a href="mailto:airkingmech@gmail.com">airkingmech@gmail.com</a>
          </address>
        </div>
        <div className="sm:text-right">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#b7192f]">Your comfort proposal</p>
          <p className="mt-2 text-xl font-bold tracking-tight break-all">{number}</p>
          {date && !Number.isNaN(date.getTime()) && <p className="mt-1 text-xs text-muted-foreground">Prepared {date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}</p>}
          <span className={`inline-flex mt-3 rounded-full border px-3 py-1 text-xs font-semibold ${label === "Accepted" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-muted text-foreground"}`}>{label}</span>
        </div>
      </div>
      <div className="my-6 h-px bg-[linear-gradient(90deg,#c99828_0_30%,#e2e8f0_30%_100%)]" />
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Prepared especially for</p><p className="mt-2 font-semibold">{customerName}</p></div>
        <div><h1 className="text-xl sm:text-2xl font-bold tracking-tight leading-snug break-words">{title}</h1><p className="mt-2 text-xs text-muted-foreground">Local service. Clear options. Comfort you can count on.</p></div>
      </div>
    </div>
  </header>;
}

export function QuoteGuide() {
  return <div className="quote-guide grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl bg-[#13243a] text-white px-5 py-4 text-xs">
    {["Compare your options", "Choose your upgrades", "Review and approve"].map((text, i) => <div key={text} className="flex items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/30 text-[#e6bf62] font-bold">{i + 1}</span>{text}</div>)}
  </div>;
}

export function QuoteFooter() {
  return <footer className="quote-footer border-t pt-5 pb-2 text-center text-xs text-muted-foreground leading-6">
    <p className="font-semibold text-foreground">Thank you for choosing Air King Mechanical Services LLC.</p>
    <p>1820 NE 288th St · Turney, MO 64493</p>
    <p><a href="tel:+18165196067">(816) 519-6067</a> · <a href="mailto:airkingmech@gmail.com">airkingmech@gmail.com</a></p>
  </footer>;
}
