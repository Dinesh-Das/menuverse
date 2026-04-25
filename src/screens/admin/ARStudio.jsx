import React, { useState, useEffect } from 'react';
import AdminLayout from '../../components/AdminLayout';

const AR_LOG_LINES = [
  { ts: '00:00:01', text: 'Initializing Neural Rendering Engine v4.2.1...', active: false },
  { ts: '00:00:02', text: 'Connecting to compute cluster (gpu-pool-alpha)...', active: false },
  { ts: '00:00:04', text: 'Loading source assets for "Truffle Risotto"...', active: false },
  { ts: '00:00:05', text: 'Texture resolution exceeds optimal bounds. Downsampling...', active: false },
  { ts: '00:00:08', text: 'Generating geometry from point cloud data...', active: true },
  { ts: '00:00:12', text: 'Applying physically based materials (PBR)...', active: false },
  { ts: '00:00:15', text: 'Commencing radiosity bake for realistic lighting...', active: false },
  { ts: '00:00:18', text: 'Optimizing mesh topology for web delivery...', active: false },
  { ts: '00:00:20', text: 'Exporting to .glb format...', active: false },
  { ts: '00:00:21', text: 'Uploading artifact to edge CDN...', active: false },
  { ts: '00:00:22', text: 'AR Generation Complete. Ready for deployment.', active: false }
];

export default function ARStudio() {
  const [logs, setLogs] = useState([]);
  
  useEffect(() => {
    let currentIdx = 0;
    const timer = setInterval(() => {
      if (currentIdx < AR_LOG_LINES.length) {
        setLogs(prev => [...prev, AR_LOG_LINES[currentIdx]]);
        currentIdx++;
      } else {
        clearInterval(timer);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  const cardBg = 'bg-surface-container border border-outline-variant/10 shadow-luxury';

  return (
    <AdminLayout>
      <main className="admin-content min-h-screen">
        {/* ── Header ────────────────────────────────────── */}
        <header className="flex justify-between items-center px-16 py-12 bg-background">
          <div>
            <h2 className="text-4xl font-headline font-semibold tracking-tight text-on-surface">
              AR Studio Pipeline
            </h2>
            <p className="font-body mt-2 text-sm text-on-surface-variant">
              Butter Chicken | <span className="font-medium text-primary">Asset ID: #88291-BC</span>
            </p>
          </div>
          <div className="flex items-center gap-8 hidden md:flex">
            <div className="text-right">
              <p className="text-[9px] uppercase font-bold tracking-[0.2em] mb-1 text-primary">Model Status</p>
              <p className="font-medium text-lg text-on-surface">Mesh Optimization</p>
            </div>
            <div className="h-14 w-14 rounded-full overflow-hidden ring-1 ring-offset-4 ring-outline-variant ring-offset-background">
              <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuCau8Sg-UDmdsTWp-jvnd5quPgW52TVolp1JeRQDQupfb5a5JOVd0hbxzyUq-kOdGkKcHrcNh6Jdgyq9Q2BYR0o5pi0AIHjCb6DG7SxUgs3VLpm09V5WFH0nGdwKJoDOI6NNhg_J0RFAKQKKC_XiKMLnnWiaSGtidZ2_I91M5nfPYgtiQuGIm9mLdq4N0iaXeMayevMqSYLqD-DDjxkh3PLtzr74zLf92Ow_vImThxIFaY0cuLxyyNc8gGpABmlRmgnhYw7dUqp2WzT" alt="Admin" className="h-full w-full object-cover transition-all duration-700" />
            </div>
          </div>
        </header>

        {/* ── Stepper Pipeline ──────────────────────────── */}
        <section className="px-16 py-8">
          <div className="relative flex justify-between max-w-5xl">
            {/* Lines */}
            <div className="absolute top-5 left-0 w-full h-[1px] z-0 bg-outline-variant/30"></div>
            <div className="absolute top-5 left-0 w-[75%] h-[1px] z-0 bg-primary"></div>
            
            {/* Steps */}
            {[
              { label: 'Uploading', state: 'complete', icon: 'check' },
              { label: 'Validation', state: 'complete', icon: 'check' },
              { label: 'Photogrammetry', state: 'complete', icon: 'check' },
              { label: 'Optimization', state: 'active', icon: 'change_circle' },
              { label: 'Ready', state: 'pending', icon: 'rocket_launch' }
            ].map((step, idx) => (
              <div key={idx} className="relative z-10 flex flex-col items-center gap-4">
                <div className={`h-10 w-10 rounded-full flex items-center justify-center
                  ${step.state === 'complete' ? 'bg-primary text-on-primary shadow-luxury' : ''}
                  ${step.state === 'active' ? 'bg-surface border-2 border-primary text-primary animate-pulse' : ''}
                  ${step.state === 'pending' ? 'bg-surface-container text-on-surface-variant/40 border border-outline-variant/30' : ''}
                `}>
                  <span className="material-symbols-outlined text-lg font-bold">{step.icon}</span>
                </div>
                <span className={`text-[10px] uppercase font-bold tracking-[0.15em] 
                  ${step.state !== 'pending' ? 'text-primary' : 'text-on-surface-variant/40'}
                `}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Main Workspace ────────────────────────────── */}
        <section className="px-16 py-8 grid grid-cols-12 gap-12 pb-24">
          
          {/* Left Col: Video + Logs */}
          <div className="col-span-12 lg:col-span-5 flex flex-col gap-8">
            {/* Video Preview Card */}
            <div className={`${cardBg} rounded-xl overflow-hidden group relative`}>
              <div className="aspect-video relative overflow-hidden bg-surface-container">
                <img 
                  src="https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=800&q=80" 
                  alt="Source Video" 
                  className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <button className="h-16 w-16 rounded-full flex items-center justify-center border hover:scale-110 transition-transform cursor-pointer glass-dark border-primary/20 text-primary">
                    <span className="material-symbols-outlined text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                  </button>
                </div>
                <div className="absolute bottom-6 left-6 flex gap-3">
                  <span className="px-3 py-1 rounded text-[9px] font-bold tracking-[0.2em] uppercase border bg-surface/90 text-on-surface border-outline-variant/30">Source Video</span>
                  <span className="px-3 py-1 rounded text-[9px] font-bold tracking-[0.2em] uppercase bg-primary/90 text-on-primary">4K / 60FPS</span>
                </div>
              </div>
              <div className="p-8">
                <h3 className="font-headline text-xl font-semibold mb-6 text-on-surface">Input Stream Analysis</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div className="p-5 rounded-lg border bg-primary-container/20 border-primary/10">
                    <p className="text-[9px] uppercase font-bold tracking-[0.15em] mb-1 text-primary">Total Frames</p>
                    <p className="text-2xl font-bold text-on-surface">1,240</p>
                  </div>
                  <div className="p-5 rounded-lg border bg-primary-container/20 border-primary/10">
                    <p className="text-[9px] uppercase font-bold tracking-[0.15em] mb-1 text-primary">Coverage</p>
                    <p className="text-2xl font-bold text-on-surface">94.2%</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Optimization Logs */}
            <div className="p-8 rounded-xl font-body text-[11px] h-52 overflow-y-auto leading-relaxed custom-scrollbar bg-surface-container-high border border-outline-variant/20">
              {logs.map((log, i) => (
                <p key={i} className={`mb-1 ${log.active ? 'text-primary font-medium italic animate-pulse' : 'text-on-surface-variant'}`}>
                  [{log.ts}] {log.text}
                </p>
              ))}
              {logs.length < AR_LOG_LINES.length && (
                <p className="mb-1 animate-pulse text-on-surface-variant/50">_</p>
              )}
            </div>
          </div>

          {/* Right Col: 3D Model Viewer Card */}
          <div className="col-span-12 lg:col-span-7 flex flex-col gap-10">
            <div className={`${cardBg} rounded-xl flex-1 relative overflow-hidden`}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent pointer-events-none"></div>
              
              <div className="w-full h-full flex flex-col items-center justify-center relative p-16">
                <div className="relative group cursor-grab active:cursor-grabbing">
                  <div className="absolute -inset-16 blur-[100px] rounded-full opacity-60 bg-primary/20"></div>
                  <img 
                    src="https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=800&q=80" 
                    alt="3D Mesh" 
                    className="w-96 h-96 object-contain drop-shadow-[0_40px_70px_rgba(0,0,0,0.12)] transform transition-transform duration-1000 animate-float"
                    style={{ maskImage: 'radial-gradient(circle, black 40%, transparent 70%)', WebkitMaskImage: 'radial-gradient(circle, black 40%, transparent 70%)' }}
                  />
                </div>

                {/* Viewer Controls */}
                <div className="absolute top-8 right-8 flex flex-col gap-4">
                  {['grid_on', 'light_mode', 'zoom_in'].map(icon => (
                    <button key={icon} className="h-11 w-11 rounded-full flex items-center justify-center border transition-all cursor-pointer glass-dark border-primary/20 text-on-surface-variant hover:text-primary hover:bg-surface-container">
                      <span className="material-symbols-outlined">{icon}</span>
                    </button>
                  ))}
                </div>

                {/* Quality Badges */}
                <div className="absolute bottom-8 left-8 flex gap-5">
                  <div className="flex items-center gap-4 px-5 py-4 rounded-xl border glass-dark border-primary/20">
                    <div className="h-9 w-9 rounded flex items-center justify-center font-bold text-xs bg-primary text-on-primary">A</div>
                    <div>
                      <p className="text-[8px] uppercase font-bold leading-none tracking-widest text-on-surface-variant">Resolution</p>
                      <p className="text-[11px] font-semibold mt-1 text-on-surface">Premium Ultra-HD</p>
                    </div>
                  </div>
                </div>

                <div className="absolute bottom-8 right-8">
                  <button 
                    disabled 
                    title="AR Studio generation is a mock preview — coming soon!" 
                    className="flex items-center gap-4 px-10 py-5 rounded-lg font-bold text-xs uppercase tracking-[0.2em] shadow-2xl transition-all group cursor-not-allowed bg-on-surface text-background opacity-50"
                  >
                    Publish to Menu
                    <span className="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">arrow_forward</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Detailed Stats Panel */}
            <div className="grid grid-cols-3 gap-8">
              {[
                { label: 'File Size', val: '12.4', unit: 'MB', sub: 'Highly Optimized' },
                { label: 'Triangles', val: '45.2', unit: 'K', sub: 'Retopology: Done' },
                { label: 'Load Time', val: '0.8', unit: 's', sub: 'On 5G Connection' }
              ].map(stat => (
                <div key={stat.label} className={`p-8 rounded-xl ${cardBg}`}>
                  <p className="text-[9px] uppercase font-bold tracking-[0.2em] mb-2 text-on-surface-variant/60">{stat.label}</p>
                  <p className="text-3xl font-headline font-bold text-on-surface">
                    {stat.val}<span className="text-sm font-body ml-1 text-primary">{stat.unit}</span>
                  </p>
                  <p className="text-[10px] font-medium mt-3 text-primary">{stat.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </AdminLayout>
  );
}
