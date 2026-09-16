import CustomerDocument, { Unsubscribe } from "@/pages/customer-document";
import { Automations, Templates, Integrations } from "@/pages/communications";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { DataProvider } from "@/context/data-context";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Customers from "@/pages/customers";
import CustomerDetail from "@/pages/customer-detail";
import Pricebook from "@/pages/pricebook";
import Quotes from "@/pages/quote-builder";
import Proposal from "@/pages/proposal";
import Schedule from "@/pages/schedule";
import CrownCare from "@/pages/crown-care";
import Invoices from "@/pages/invoices";
import InvoiceView from "@/pages/invoice-view";
import TimeClock from "@/pages/time-clock";
import Users from "@/pages/users";
import Referrals from "@/pages/referrals";
import Marketing from "@/pages/marketing";
import Inventory from "@/pages/inventory";
import Leads from "@/pages/leads";
import NotFound from "@/pages/not-found";

function InternalRouter() {
  const { profile } = useAuth();
  const can = (key: string) => profile?.role === "owner" || profile?.permissions?.[key] !== false;
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/customers">{can("customers") ? <Customers /> : <AccessDenied />}</Route>
        <Route path="/leads">{can("leads") ? <Leads /> : <AccessDenied />}</Route>
        <Route path="/customers/:id">{can("customers") ? <CustomerDetail /> : <AccessDenied />}</Route>
        <Route path="/pricebook">{can("pricebook") ? <Pricebook /> : <AccessDenied />}</Route>
        <Route path="/quotes">{can("quotes") ? <Quotes /> : <AccessDenied />}</Route>
        <Route path="/time-clock">{can("time_clock") ? <TimeClock /> : <AccessDenied />}</Route>
        <Route path="/schedule">{can("schedule") ? <Schedule /> : <AccessDenied />}</Route>
        <Route path="/crown-care">{can("memberships") ? <CrownCare /> : <AccessDenied />}</Route>
        <Route path="/invoices">{can("invoices") ? <Invoices /> : <AccessDenied />}</Route>
        <Route path="/referrals">{can("referrals") ? <Referrals /> : <AccessDenied />}</Route>
        <Route path="/marketing">{can("marketing") ? <Marketing /> : <AccessDenied />}</Route>
        <Route path="/inventory">{can("inventory") ? <Inventory /> : <AccessDenied />}</Route>
        <Route path="/automations">{can("automations") ? <Automations /> : <AccessDenied />}</Route>
        <Route path="/templates">{can("communications") ? <Templates /> : <AccessDenied />}</Route>
        <Route path="/integrations">{can("communications") ? <Integrations /> : <AccessDenied />}</Route>
        <Route path="/team">{profile?.role === "owner" ? <Users /> : <AccessDenied />}</Route>
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

// Customer-facing routes render standalone — no internal sidebar,
// no admin nav, no access to other customer data. These are the
// pages linked to customers via the Send dialog.
function AppRouter() {
  return (
    <Switch>
      <Route path="/proposals/:id" component={Proposal} />
      <Route path="/invoices/view/:id" component={InvoiceView} />
      <Route>
        <InternalRouter />
      </Route>
    </Switch>
  );
}

function AccessDenied() { return <div className="p-8"><h1 className="text-xl font-bold">Access restricted</h1><p className="text-sm text-muted-foreground mt-2">Ask the owner to enable this area in Team permissions.</p></div>; }

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/customer/:token" component={CustomerDocument} />
              <Route path="/unsubscribe/:token" component={Unsubscribe} />
              <Route>
                <Gate />
              </Route>
            </Switch>
          </Router>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Gate() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!session) return <Login />;
  return (
    <DataProvider>
      <Router hook={useHashLocation}>
        <AppRouter />
      </Router>
    </DataProvider>
  );
}

export default App;
