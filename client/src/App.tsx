import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/app-shell";
import { DataProvider } from "@/context/data-context";
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
        <DataProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </DataProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
