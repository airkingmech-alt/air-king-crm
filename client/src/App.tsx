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
import Users from "@/pages/users";
import Referrals from "@/pages/referrals";
import Marketing from "@/pages/marketing";
import NotFound from "@/pages/not-found";

function InternalRouter() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/customers" component={Customers} />
        <Route path="/customers/:id" component={CustomerDetail} />
        <Route path="/pricebook" component={Pricebook} />
        <Route path="/quotes" component={Quotes} />
        <Route path="/schedule" component={Schedule} />
        <Route path="/crown-care" component={CrownCare} />
        <Route path="/invoices" component={Invoices} />
        <Route path="/referrals" component={Referrals} />
        <Route path="/marketing" component={Marketing} />
        <Route path="/automations" component={Automations} />
        <Route path="/templates" component={Templates} />
        <Route path="/integrations" component={Integrations} />
        <Route path="/team" component={Users} />
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
