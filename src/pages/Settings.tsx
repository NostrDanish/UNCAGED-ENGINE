/**
 * Settings page — the essentials:
 *
 *   - Appearance:    light / dark / system
 *   - Indexing:      auto-index toggle + this device's SIP-01 indexer identity
 *   - Your Relays:   NIP-65 relay list (publishes kind 10002 when logged in)
 *   - Search Relays: the NIP-50 relay pool used for search, with latency test
 */
import { useState, useSyncExternalStore } from 'react';
import { useSeoMeta } from '@unhead/react';
import {
  Settings as SettingsIcon, Sun, Moon, Monitor,
  Plus, Trash2, RefreshCw, RotateCcw, Globe, Fingerprint, Copy, Download,
  CheckCircle2, XCircle, CircleDashed, Check, Zap,
} from 'lucide-react';

import { Layout } from '@/components/Layout';
import { RelayListManager } from '@/components/RelayListManager';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/useToast';
import { useTheme } from '@/hooks/useTheme';
import { useAppContext } from '@/hooks/useAppContext';
import { useSearchRelayPool } from '@/hooks/useSearchRelayPool';
import {
  getIndexerIdentity, regenerateIndexerIdentity, exportIndexerNsec,
} from '@/lib/indexerIdentity';
import { getSessionPublishedCount, subscribeSessionStats } from '@/lib/indexPublisher';
import type { Theme } from '@/contexts/AppContext';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/* ------------------------------------------------------------------ */

const THEMES: { value: Theme; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'light', label: 'Light', icon: <Sun className="w-4 h-4" />, description: 'Clean and bright' },
  { value: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" />, description: 'Easy on the eyes' },
  { value: 'system', label: 'System', icon: <Monitor className="w-4 h-4" />, description: 'Follows your device' },
];

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Appearance</h2>
      <p className="text-xs text-muted-foreground mb-4">Choose how the app looks.</p>
      <div className="grid grid-cols-3 gap-2">
        {THEMES.map((t) => {
          const active = theme === t.value;
          return (
            <button
              key={t.value}
              onClick={() => setTheme(t.value)}
              aria-pressed={active}
              className={cn(
                'flex flex-col items-center gap-1.5 px-3 py-4 rounded-xl border text-center transition-colors',
                active
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border/60 bg-card text-muted-foreground hover:text-foreground hover:border-border',
              )}
            >
              <span className={cn(active && 'text-primary')}>{t.icon}</span>
              <span className="text-sm font-medium flex items-center gap-1.5">
                {t.label}
                {active && <Check className="w-3.5 h-3.5 text-primary" />}
              </span>
              <span className="text-xs text-muted-foreground/70">{t.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Indexing (Search Index Protocol identity)                           */
/* ------------------------------------------------------------------ */

function IndexingSection() {
  const { config, updateConfig } = useAppContext();
  const { toast } = useToast();
  const autoIndex = config.autoIndex;

  // Read the device identity once per mount; regenerate bumps this state.
  const [identity, setIdentity] = useState(() => getIndexerIdentity());

  // Live session counter — proof the indexer is working.
  const publishedCount = useSyncExternalStore(subscribeSessionStats, getSessionPublishedCount);

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${what} copied` });
    } catch {
      toast({ title: 'Copy failed', description: 'Clipboard is unavailable.', variant: 'destructive' });
    }
  };

  const exportKey = async () => {
    const nsec = exportIndexerNsec();
    await copy(nsec, 'Indexing key (nsec)');
  };

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Indexing</h2>
      <p className="text-xs text-muted-foreground mb-4">
        How this browser contributes to the shared decentralized web index (SIP-01, kind 39697).
      </p>

      {/* Auto-index toggle */}
      <Card className={cn('mb-4 transition-colors', autoIndex ? 'border-primary/30 bg-primary/5' : 'border-border/60')}>
        <CardContent className="py-4 flex items-start gap-4">
          <div className={cn(
            'flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border',
            autoIndex ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-muted text-muted-foreground border-border',
          )}>
            <Globe className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Automatic indexing</span>
              <Switch
                checked={autoIndex}
                onCheckedChange={(checked) => updateConfig(() => ({ autoIndex: checked }))}
                aria-label="Toggle automatic indexing"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              When enabled, web pages discovered during your searches (files and links
              referenced by Nostr content, plus results from any external providers) and
              web links submitted to the community index are anonymously contributed to
              the shared Nostr index — one small event per URL, containing only the page's
              public title and description. <strong className="text-foreground">Your
              search queries are never published</strong>, and your personal Nostr identity
              is never used.
            </p>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', publishedCount > 0 ? 'bg-green-500' : 'bg-muted-foreground/30')} />
              {publishedCount > 0
                ? `${publishedCount} observation${publishedCount !== 1 ? 's' : ''} published this session`
                : 'No observations published yet this session — they appear here as you search.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Indexing identity */}
      <Card className="border-border/60">
        <CardContent className="py-4 flex items-start gap-4">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 border bg-muted text-muted-foreground border-border">
            <Fingerprint className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Indexing identity</span>
              <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-600 dark:text-green-500">
                Active
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              A dedicated keypair generated on this device, used only for automatic indexing.
              It is <strong className="text-foreground">not</strong> your Nostr account — the two
              are never linked. It guarantees key separation, not network anonymity (relays
              still see IP/timing).
            </p>

            {/* Public key */}
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
                {identity.npub}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => void copy(identity.npub, 'Indexing npub')}
                aria-label="Copy indexing public key"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Actions */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => void exportKey()}>
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Export key
              </Button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    Regenerate
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate indexing identity?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <span className="block">
                        This creates a <strong>brand-new indexer</strong>. Nothing is deleted,
                        but:
                      </span>
                      <span className="block">
                        · events you already published stay signed by the <em>old</em> key;
                        <br />
                        · the new key does <em>not</em> inherit any reputation or history;
                        <br />
                        · your previous indexing history remains tied to the old key.
                      </span>
                      <span className="block">
                        Only do this if you want to start over as a fresh indexer.
                      </span>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep current identity</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setIdentity(regenerateIndexerIdentity());
                        toast({
                          title: 'New indexing identity active',
                          description: 'Future index events are signed by the new key.',
                        });
                      }}
                    >
                      Regenerate
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Your relays (NIP-65)                                                */
/* ------------------------------------------------------------------ */

function YourRelaysSection() {
  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold mb-1">Your Relays</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Your NIP-65 relay list — where your profile, submissions, and other events are
        published and read. Changes sync to Nostr (kind 10002) when you're logged in.
      </p>
      <Card className="border-border/60">
        <CardContent className="py-4">
          <RelayListManager />
        </CardContent>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Search relays (NIP-50 pool)                                         */
/* ------------------------------------------------------------------ */

function SearchRelaysSection() {
  const { pool, testing, testRelays, addRelay, removeRelay, restoreDefaults, removedCount } = useSearchRelayPool();
  const { toast } = useToast();
  const [newUrl, setNewUrl] = useState('');

  const handleAdd = () => {
    if (!newUrl.trim()) return;
    const added = addRelay(newUrl);
    if (added) {
      toast({
        title: added.origin === 'default' ? 'Default relay restored' : 'Search relay added',
        description: `${added.url} is now queried on every search.`,
      });
      setNewUrl('');
    } else {
      toast({
        title: 'Invalid relay URL',
        description: 'Enter a valid relay, e.g. wss://relay.example.com',
        variant: 'destructive',
      });
    }
  };

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-1 gap-2">
        <h2 className="text-sm font-semibold">Search Relays</h2>
        <div className="flex items-center gap-2">
          {removedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                restoreDefaults();
                toast({ title: 'Defaults restored', description: 'All built-in search relays are back in the pool.' });
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Restore defaults
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void testRelays()}
            disabled={testing}
          >
            <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', testing && 'animate-spin')} />
            {testing ? 'Testing…' : 'Test latency'}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Relays queried in parallel for every search (Nostr content, the SIP-01 web index,
        and the community index) — and the first publish target for index observations.
        Add your own relays, or remove any default you don't trust.
      </p>

      {/* Add custom */}
      <Card className="mb-4 border-primary/20">
        <CardContent className="py-4">
          <div className="flex gap-2">
            <Input
              placeholder="wss://relay.example.com"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="font-mono text-sm"
              aria-label="Custom search relay URL"
            />
            <Button onClick={handleAdd} className="shrink-0">
              <Plus className="w-4 h-4 mr-1.5" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pool */}
      <div className="space-y-2">
        {pool.map((entry) => {
          const hostname = (() => {
            try { return new URL(entry.url).host; } catch { return entry.url; }
          })();

          return (
            <div
              key={entry.url}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border/60 bg-card hover:border-border transition-colors"
            >
              <Zap className="w-4 h-4 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-sm truncate">{hostname}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] px-1.5 py-0',
                      entry.origin === 'default'
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : 'bg-muted text-muted-foreground border-border',
                    )}
                  >
                    {entry.origin === 'default' ? 'Default' : 'Custom'}
                  </Badge>
                </div>
                {entry.status === 'untested' && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CircleDashed className="w-3.5 h-3.5" />
                    Untested
                  </span>
                )}
                {entry.status === 'testing' && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Testing…
                  </span>
                )}
                {entry.status === 'ok' && (
                  <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-500">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Reachable{entry.latencyMs !== undefined ? ` · ${entry.latencyMs}ms` : ''}
                  </span>
                )}
                {entry.status === 'error' && (
                  <span className="flex items-center gap-1.5 text-xs text-destructive">
                    <XCircle className="w-3.5 h-3.5" />
                    Unreachable
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => {
                  removeRelay(entry.url);
                  toast({
                    title: entry.origin === 'default' ? 'Default relay removed' : 'Search relay removed',
                    description: `${entry.url} — restore defaults anytime to bring built-ins back.`,
                  });
                }}
                aria-label={`Remove ${hostname}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Settings() {
  useSeoMeta({
    title: 'Settings - Uncaged Engine',
    description: 'Appearance, indexing identity, and relay configuration.',
  });

  return (
    <Layout>
      <div className="container max-w-2xl py-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
            <SettingsIcon className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        </div>
        <p className="text-muted-foreground mb-8">
          Everything is stored locally in your browser. Nothing leaves your device except search queries to relays.
        </p>

        <AppearanceSection />
        <Separator className="mb-10" />
        <IndexingSection />
        <Separator className="mb-10" />
        <YourRelaysSection />
        <Separator className="mb-10" />
        <SearchRelaysSection />
      </div>
    </Layout>
  );
}
