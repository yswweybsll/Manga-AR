import { useEffect, useState } from 'react';

import { Button } from './components/ui/button';

type RendererHostServerState = Awaited<ReturnType<typeof window.mangaArStudio.host.getState>>;

export function App() {
  const [hostState, setHostState] = useState<RendererHostServerState>(null);

  async function refreshHostState() {
    const nextState = await window.mangaArStudio.host.getState();
    setHostState(nextState);
  }

  useEffect(() => {
    void refreshHostState();
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Manga AR Studio</h1>
            <p className="text-sm text-muted-foreground">电脑端 host 与场景管理工作台</p>
          </div>
          <Button onClick={() => void refreshHostState()}>刷新状态</Button>
        </div>

        <div className="rounded-lg border bg-card p-4 text-card-foreground">
          <h2 className="text-base font-medium">Host 状态</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">运行状态</dt>
              <dd>{hostState?.running ? '运行中' : '未启动'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">端口</dt>
              <dd>{hostState?.hostInfo.httpPort ?? '-'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">局域网地址</dt>
              <dd>{hostState?.addresses.join(', ') || '-'}</dd>
            </div>
          </dl>
        </div>
      </section>
    </main>
  );
}
