import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, Sale, CartItem, PaymentMethod, AppTab, UserRole, StockFilter, Staff } from './types';
import { Icons, CURRENCY, LOW_STOCK_THRESHOLD as DEFAULT_THRESHOLD } from './constants';
import { Calculator } from './components/Calculator';
import { getBusinessInsights } from './services/gemini';

const BUSINESS_NAME = 'AfriPOS';

interface FlyingItem {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  duration: number;
}

interface UndoState {
  cart: CartItem[];
  products: Product[];
  message: string;
}

const BarcodeScanner: React.FC<{ onDetected: (code: string) => void; onClose: () => void }> = ({ onDetected, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let isActive = true;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // @ts-ignore
        if (!('BarcodeDetector' in window)) {
          setError("Scanner requires a modern browser with Barcode API.");
          return;
        }

        // @ts-ignore
        const barcodeDetector = new window.BarcodeDetector();

        const scan = async () => {
          if (!isActive || !videoRef.current) return;
          try {
            // @ts-ignore
            const barcodes = await barcodeDetector.detect(videoRef.current);
            if (barcodes.length > 0) {
              onDetected(barcodes[0].rawValue);
              isActive = false;
              return;
            }
          } catch (e) { console.debug(e); }
          if (isActive) requestAnimationFrame(scan);
        };
        requestAnimationFrame(scan);

      } catch (err) {
        setError("Camera access denied.");
      }
    };

    startCamera();
    return () => {
      isActive = false;
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 bg-slate-950 z-[100] flex flex-col items-center justify-center p-6 backdrop-blur-md no-print">
      <div className="relative w-full max-w-sm aspect-square bg-slate-900 rounded-[2.5rem] overflow-hidden border-8 border-white/10 shadow-2xl">
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
        <div className="absolute inset-0 border-[60px] border-black/40 pointer-events-none">
          <div className="w-full h-full border-2 border-blue-400 rounded-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-blue-400 shadow-[0_0_20px_rgba(96,165,250,1)] animate-scan-line"></div>
          </div>
        </div>
        {error && <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-8 text-center text-red-400 font-bold">{error}</div>}
      </div>
      <button onClick={onClose} className="mt-8 bg-white text-slate-900 px-12 py-4 rounded-2xl font-black shadow-xl">CANCEL SCAN</button>
      <style>{`
        @keyframes scan-line { 0% { transform: translateY(0); } 100% { transform: translateY(300px); } }
        .animate-scan-line { animation: scan-line 1.5s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

const App: React.FC = () => {
  // Authentication & Session State
  const [currentUser, setCurrentUser] = useState<Staff | null>(null);
  const [staff, setStaff] = useState<Staff[]>(() => {
    const saved = localStorage.getItem('afripos_staff');
    return saved ? JSON.parse(saved) : [
      { id: '1', name: 'Owner', pin: '0000', role: 'OWNER' },
      { id: '2', name: 'Main Cashier', pin: '1111', role: 'CASHIER' },
      { id: '3', name: 'Junior Staff', pin: '2222', role: 'EMPLOYEE' }
    ];
  });

  const [activeTab, setActiveTab] = useState<AppTab>('POS');
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showReceipt, setShowReceipt] = useState<Sale | null>(null);
  const [insights, setInsights] = useState<string>('Your AI business assistant is ready.');
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [posSearchQuery, setPosSearchQuery] = useState('');
  const [posStockFilter, setPosStockFilter] = useState<StockFilter>('ALL');
  const [flyingItems, setFlyingItems] = useState<FlyingItem[]>([]);
  const [isCartBumping, setIsCartBumping] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [sessionStart, setSessionStart] = useState<number>(Date.now());
  
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [showUndoToast, setShowUndoToast] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [lowStockThreshold, setLowStockThreshold] = useState<number>(() => {
    const saved = localStorage.getItem('afripos_low_stock_threshold');
    return saved ? parseInt(saved) : DEFAULT_THRESHOLD;
  });
  
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('afripos_theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  
  useEffect(() => {
    const root = window.document.documentElement;
    if (isDarkMode) root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('afripos_theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    const savedProducts = localStorage.getItem('afripos_products');
    const savedSales = localStorage.getItem('afripos_sales');
    if (savedProducts) setProducts(JSON.parse(savedProducts));
    if (savedSales) setSales(JSON.parse(savedSales));
  }, []);

  useEffect(() => { localStorage.setItem('afripos_products', JSON.stringify(products)); }, [products]);
  useEffect(() => { localStorage.setItem('afripos_sales', JSON.stringify(sales)); }, [sales]);
  useEffect(() => { localStorage.setItem('afripos_staff', JSON.stringify(staff)); }, [staff]);
  useEffect(() => { localStorage.setItem('afripos_low_stock_threshold', lowStockThreshold.toString()); }, [lowStockThreshold]);

  const fetchInsights = async () => {
    if (isInsightLoading) return;
    setIsInsightLoading(true);
    setInsights('Analyzing data...');
    try {
      const text = await getBusinessInsights(products, sales);
      setInsights(text);
    } catch (err) { setInsights("Unable to reach AI advisor."); }
    finally { setIsInsightLoading(false); }
  };

  useEffect(() => { if (activeTab === 'Insights') fetchInsights(); }, [activeTab]);

  const saveUndoSnapshot = (message: string) => {
    setUndoState({ cart: JSON.parse(JSON.stringify(cart)), products: JSON.parse(JSON.stringify(products)), message });
    setShowUndoToast(true);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setShowUndoToast(false), 4000);
  };

  const performUndo = () => {
    if (!undoState) return;
    setCart(undoState.cart);
    setProducts(undoState.products);
    setShowUndoToast(false);
    setUndoState(null);
  };

  const addToCart = (product: Product, event?: React.MouseEvent) => {
    if (product.stock <= 0) return alert('Out of stock!');
    saveUndoSnapshot(`${product.name} added`);
    
    let startX = window.innerWidth / 2, startY = window.innerHeight / 2;
    if (event) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      startX = rect.left + rect.width / 2;
      startY = rect.top + rect.height / 2;
    }
    
    const animationId = crypto.randomUUID();
    setFlyingItems(prev => [...prev, { id: animationId, startX, startY, endX: 50, endY: window.innerHeight - 50, duration: 600 }]);
    
    setTimeout(() => {
      setFlyingItems(prev => prev.filter(item => item.id !== animationId));
      setIsCartBumping(true);
      setTimeout(() => setIsCartBumping(false), 200);
    }, 600);

    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { ...product, quantity: 1 }];
    });
    setProducts(products.map(p => p.id === product.id ? { ...p, stock: p.stock - 1 } : p));
  };

  const handleCheckout = (method: PaymentMethod) => {
    if (cart.length === 0) return;
    const newSale: Sale = {
      id: crypto.randomUUID(),
      items: [...cart],
      total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
      paymentMethod: method,
      timestamp: Date.now(),
      sellerRole: currentUser?.role || 'EMPLOYEE'
    };
    setSales([newSale, ...sales]);
    setShowReceipt(newSale);
    setCart([]);
    setShowUndoToast(false);
  };

  const filteredPosProducts = useMemo(() => products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(posSearchQuery.toLowerCase());
    let matchesStock = true;
    if (posStockFilter === 'IN_STOCK') matchesStock = p.stock > lowStockThreshold;
    else if (posStockFilter === 'LOW_STOCK') matchesStock = p.stock > 0 && p.stock <= lowStockThreshold;
    else if (posStockFilter === 'OUT_OF_STOCK') matchesStock = p.stock <= 0;
    return matchesSearch && matchesStock;
  }), [products, posSearchQuery, posStockFilter, lowStockThreshold]);

  const shiftSummary = useMemo(() => {
    const sessionSales = sales.filter(s => s.timestamp >= sessionStart);
    return {
      total: sessionSales.reduce((acc, s) => acc + s.total, 0),
      count: sessionSales.length
    };
  }, [sales, sessionStart]);

  const [loginPin, setLoginPin] = useState('');
  const handleLogin = () => {
    const foundUser = staff.find(s => s.pin === loginPin);
    if (foundUser) {
      setCurrentUser(foundUser);
      setSessionStart(Date.now());
      setActiveTab('POS');
      setLoginPin('');
    } else if (loginPin.length === 4) {
      alert('Access Denied');
      setLoginPin('');
    }
  };

  useEffect(() => { if (loginPin.length === 4) handleLogin(); }, [loginPin]);

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-blue-600 flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8 animate-in fade-in zoom-in-95 duration-500 text-center">
          <div className="space-y-2">
            <h1 className="text-6xl font-black text-white tracking-tighter uppercase">{BUSINESS_NAME}</h1>
            <p className="text-blue-100 font-bold tracking-widest uppercase text-[10px]">Secure Multi-Role Terminal</p>
          </div>
          <div className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-2xl space-y-6 border-4 border-white/20">
            <div className="space-y-4">
               <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Enter Personal PIN</p>
               <input type="password" inputMode="numeric" maxLength={4} value={loginPin} onChange={(e) => setLoginPin(e.target.value)} placeholder="••••" className="w-full text-center text-5xl font-black tracking-[0.8em] p-6 bg-slate-50 dark:bg-slate-800 rounded-3xl outline-none focus:ring-4 ring-blue-500/20" autoFocus />
            </div>
            <div className="grid grid-cols-1 gap-1 pt-2">
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest italic">Owner: 0000</p>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest italic">Cashier: 1111</p>
                <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest italic">Employee: 2222</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isOwner = currentUser.role === 'OWNER';
  const isCashier = currentUser.role === 'CASHIER';
  const isEmployee = currentUser.role === 'EMPLOYEE';

  return (
    <div className="min-h-screen flex flex-col max-w-lg mx-auto bg-white dark:bg-dark-bg relative pb-28 transition-colors duration-300 shadow-2xl">
      <div className="fixed inset-0 pointer-events-none z-[100] no-print overflow-hidden">
        {flyingItems.map(item => (
          <div key={item.id} className="absolute w-10 h-10 bg-blue-600 rounded-2xl shadow-xl flex items-center justify-center text-white text-xs font-black animate-fly-v2" style={{ '--startX': `${item.startX}px`, '--startY': `${item.startY}px`, '--endX': `${item.endX}px`, '--endY': `${item.endY}px`, '--duration': `${item.duration}ms` } as React.CSSProperties}>+1</div>
        ))}
      </div>

      {isScanning && <BarcodeScanner onDetected={(code) => {
        setIsScanning(false);
        const p = products.find(prod => prod.barcode === code);
        if (p) addToCart(p);
      }} onClose={() => setIsScanning(false)} />}

      <header className="bg-blue-600 dark:bg-blue-800 text-white p-6 sticky top-0 z-40 flex justify-between items-center no-print rounded-b-[2rem] shadow-lg">
        <div className="flex items-center gap-3">
          <button onClick={() => {if(confirm("Logout?")) setCurrentUser(null)}} className="p-2 bg-white/20 rounded-xl active:scale-90"><Icons.Lock /></button>
          <div>
            <h1 className="text-2xl font-black leading-none">{BUSINESS_NAME}</h1>
            <span className="text-[10px] uppercase opacity-60 font-bold tracking-widest">{currentUser.name} • {currentUser.role}</span>
          </div>
        </div>
        <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-3 bg-white/10 rounded-2xl">{isDarkMode ? <Icons.Sun /> : <Icons.Moon />}</button>
      </header>

      <main className="flex-1 p-6 overflow-y-auto scroll-smooth-touch">
        {activeTab === 'POS' && (
          <div className="space-y-6 animate-in slide-in-from-right-5">
            <div className="flex justify-between items-center">
              <h2 className="text-3xl font-black">Register</h2>
              <button onClick={() => setIsScanning(true)} className="p-3 bg-slate-100 dark:bg-slate-700 rounded-2xl"><Icons.Barcode /></button>
            </div>
            <div className={`p-6 rounded-[2.5rem] bg-slate-50 dark:bg-dark-card border-2 border-dashed border-slate-200 dark:border-slate-700 transition-all ${isCartBumping ? 'scale-105 border-blue-500' : ''}`}>
               {cart.length === 0 ? <p className="text-center py-12 text-slate-400 font-bold">Cart is empty</p> : (
                 <div className="space-y-4">
                   {cart.map(item => (
                     <div key={item.id} className="flex justify-between items-center bg-white dark:bg-slate-800 p-3 rounded-2xl shadow-sm">
                        <span className="font-bold truncate max-w-[150px]">{item.name}</span>
                        <div className="flex items-center gap-3">
                           <span className="text-blue-600 font-black">{CURRENCY}{(item.price * item.quantity).toLocaleString()}</span>
                           <span className="bg-slate-100 dark:bg-slate-700 px-3 py-1 rounded-xl text-xs font-black">x{item.quantity}</span>
                        </div>
                     </div>
                   ))}
                   <div className="pt-4 border-t border-slate-200 dark:border-slate-700 flex justify-between items-end">
                      <span className="text-xs uppercase font-black opacity-40">Total</span>
                      <span className="text-3xl font-black">{CURRENCY}{cart.reduce((s,i) => s + i.price * i.quantity, 0).toLocaleString()}</span>
                   </div>
                 </div>
               )}
            </div>
            <div className="space-y-4">
              <input type="text" placeholder="Search..." value={posSearchQuery} onChange={e => setPosSearchQuery(e.target.value)} className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-dark-card border-none outline-none font-bold" />
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {(['ALL', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const).map(f => (
                  <button key={f} onClick={() => setPosStockFilter(f)} className={`whitespace-nowrap px-4 py-2 rounded-xl text-[10px] font-black uppercase ${posStockFilter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'}`}>{f.replace('_',' ')}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pb-40">
              {filteredPosProducts.map(p => (
                <button key={p.id} onClick={(e) => addToCart(p, e)} disabled={p.stock <= 0} className="p-4 bg-white dark:bg-dark-card rounded-[2rem] border-2 border-transparent hover:border-blue-500 text-left transition-all active:scale-95 shadow-lg relative overflow-hidden h-full flex flex-col justify-between min-h-[140px]">
                  <div>
                    <p className="font-black text-sm truncate">{p.name}</p>
                    <p className="text-blue-600 font-black mt-2">{CURRENCY}{p.price.toLocaleString()}</p>
                  </div>
                  <p className={`text-[9px] mt-1 font-bold ${p.stock <= lowStockThreshold ? 'text-red-500 animate-pulse' : 'text-slate-400'}`}>Units: {p.stock}</p>
                  {p.stock <= 0 && <div className="absolute inset-0 bg-white/60 dark:bg-black/60 flex items-center justify-center font-black text-xs text-red-500">Sold Out</div>}
                </button>
              ))}
            </div>
            {cart.length > 0 && (
              <div className="fixed bottom-24 left-4 right-4 max-w-lg mx-auto bg-slate-900/90 backdrop-blur-md p-5 rounded-[2.5rem] z-50 shadow-2xl animate-in slide-in-from-bottom-5 grid grid-cols-3 gap-3">
                  <button onClick={() => handleCheckout(PaymentMethod.CASH)} className="bg-emerald-600 text-white font-black py-4 rounded-2xl text-[10px] uppercase">Cash</button>
                  <button onClick={() => handleCheckout(PaymentMethod.MOBILE_MONEY)} className="bg-orange-500 text-white font-black py-4 rounded-2xl text-[10px] uppercase">Mobile</button>
                  <button onClick={() => handleCheckout(PaymentMethod.BANK_TRANSFER)} className="bg-blue-600 text-white font-black py-4 rounded-2xl text-[10px] uppercase">Bank</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'History' && (isOwner || isCashier) && (
          <div className="space-y-8 pb-20 animate-in slide-in-from-right-5">
            <h2 className="text-3xl font-black">Ledger</h2>
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-8 rounded-[2.5rem] shadow-xl relative overflow-hidden">
               <p className="text-[10px] font-black opacity-40 uppercase tracking-widest relative z-10">Total Sales</p>
               <p className="text-5xl font-black tracking-tighter relative z-10">{CURRENCY}{sales.reduce((s,x)=>s+x.total,0).toLocaleString()}</p>
            </div>
            <div className="space-y-4">
              {sales.length === 0 ? <p className="text-center py-12 opacity-40 font-black">NO SALES RECORDED</p> : sales.slice(0, 20).map(sale => (
                <div key={sale.id} className="p-4 bg-white dark:bg-dark-card rounded-2xl border border-slate-50 dark:border-slate-800 shadow-sm flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <div className="flex gap-2 items-center">
                      <span className="text-[9px] font-black bg-blue-50 dark:bg-blue-900/30 text-blue-600 px-2 py-0.5 rounded-full">{new Date(sale.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                      <span className="text-[8px] font-black opacity-40 uppercase">{sale.paymentMethod}</span>
                    </div>
                    <span className="text-sm font-black">{CURRENCY}{sale.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <p className="text-[10px] text-slate-400 font-bold truncate max-w-[200px]">{sale.items.map(i => i.name).join(', ')}</p>
                    <button onClick={() => setShowReceipt(sale)} className="text-[9px] font-black uppercase text-blue-600 underline">Receipt</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'Shift' && (isCashier || isEmployee) && (
          <div className="space-y-8 animate-in slide-in-from-right-5">
            <h2 className="text-3xl font-black">Shift Report</h2>
            <div className="p-8 bg-emerald-600 text-white rounded-[2.5rem] shadow-2xl space-y-4">
              <p className="text-[10px] font-black opacity-60 uppercase">Session Earnings</p>
              <p className="text-5xl font-black tracking-tighter">{CURRENCY}{shiftSummary.total.toLocaleString()}</p>
              <div className="flex gap-6 border-t border-white/10 pt-4">
                <div><p className="text-[8px] font-black opacity-60 uppercase">Sold</p><p className="font-black">{shiftSummary.count} txs</p></div>
                <div><p className="text-[8px] font-black opacity-60 uppercase">Started</p><p className="font-black">{new Date(sessionStart).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p></div>
              </div>
            </div>
            <button onClick={() => {if(confirm("End Shift?")) setCurrentUser(null)}} className="w-full py-5 bg-slate-900 text-white rounded-[2rem] font-black uppercase shadow-xl">LOGOUT / END SHIFT</button>
          </div>
        )}

        {activeTab === 'Admin' && isOwner && (
          <div className="space-y-8 animate-in slide-in-from-right-5">
            <h2 className="text-3xl font-black">Settings</h2>
            <div className="grid grid-cols-2 gap-4">
               <div className="bg-slate-900 text-white p-6 rounded-[2rem] shadow-xl"><p className="text-[8px] font-black opacity-40 uppercase tracking-widest">Global Units</p><p className="text-2xl font-black">{products.reduce((acc,p)=>acc+p.stock,0)}</p></div>
               <div className="bg-blue-600 text-white p-6 rounded-[2rem] shadow-xl"><p className="text-[8px] font-black opacity-40 uppercase tracking-widest">Active SKU</p><p className="text-2xl font-black">{products.length}</p></div>
            </div>
            <div className="p-8 bg-slate-50 dark:bg-dark-card rounded-[2.5rem] border border-slate-100 dark:border-slate-800 space-y-4">
              <h3 className="font-black text-xs uppercase text-slate-400">System Preferences</h3>
              <div className="flex justify-between items-center p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700">
                <p className="text-xs font-black">Low Stock Alert at:</p>
                <input type="number" value={lowStockThreshold} onChange={(e) => setLowStockThreshold(Number(e.target.value))} className="w-16 bg-transparent text-center font-black focus:ring-2 ring-blue-500 outline-none" />
              </div>
            </div>
            <div className="p-8 bg-slate-50 dark:bg-dark-card rounded-[2.5rem] border border-slate-100 dark:border-slate-800 space-y-4">
               <h3 className="font-black text-xs uppercase text-slate-400">Staff Access</h3>
               <div className="space-y-3">
                 {staff.map(s => (
                   <div key={s.id} className="flex justify-between items-center p-3 bg-white dark:bg-slate-800 rounded-xl">
                     <div>
                       <p className="text-xs font-black">{s.name}</p>
                       <p className="text-[9px] opacity-40 uppercase">{s.role}</p>
                     </div>
                     <div className="flex items-center gap-3">
                        <span className="text-xs font-mono font-black">{s.pin}</span>
                        {s.id !== '1' && (
                          <button onClick={() => {
                            if(confirm(`Remove ${s.name}?`)) setStaff(staff.filter(st => st.id !== s.id));
                          }} className="text-red-500 font-bold p-1">✕</button>
                        )}
                     </div>
                   </div>
                 ))}
               </div>
               <button onClick={() => {
                 const name = prompt("Staff Name:");
                 const pin = prompt("Set 4-Digit PIN:");
                 const role = prompt("Role (CASHIER or EMPLOYEE):")?.toUpperCase() as UserRole;
                 if(name && pin && (role === 'CASHIER' || role === 'EMPLOYEE')) {
                   setStaff([...staff, { id: crypto.randomUUID(), name, pin, role }]);
                 } else if (name) {
                   alert("Invalid role. Use CASHIER or EMPLOYEE.");
                 }
               }} className="bg-blue-600 text-white font-black py-3 rounded-xl text-[10px] w-full uppercase mt-4">Add Staff Member</button>
            </div>
            <button onClick={() => {if(confirm("Factory Reset? All data will be lost!")) { localStorage.clear(); location.reload(); }}} className="w-full p-6 border-4 border-red-500/20 bg-red-50 text-red-600 rounded-[2rem] font-black text-xs uppercase">Erase Local Data</button>
          </div>
        )}

        {activeTab === 'Inventory' && isOwner && (
          <div className="space-y-8 animate-in slide-in-from-right-5">
            <h2 className="text-3xl font-black">Inventory</h2>
            <div className="space-y-4">
              {products.map(p => (
                <div key={p.id} className="p-5 bg-white dark:bg-dark-card rounded-[2.5rem] shadow-sm border border-slate-50 dark:border-slate-800 flex justify-between items-center">
                   <div className="flex-1 pr-4 min-w-0">
                      <p className="font-black text-sm truncate">{p.name}</p>
                      <div className="flex gap-2 mt-1 items-center">
                        <span className={`h-2 w-2 rounded-full ${p.stock <= lowStockThreshold ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`}></span>
                        <p className={`text-[10px] font-bold ${p.stock <= lowStockThreshold ? 'text-red-500' : 'text-slate-400'}`}>{p.stock} Units</p>
                        <p className="text-[10px] font-bold text-blue-500">{CURRENCY}{p.price.toLocaleString()}</p>
                      </div>
                   </div>
                   <div className="flex gap-2">
                     <button onClick={() => {
                        const newPrice = Number(prompt("Price for " + p.name, p.price.toString()));
                        if(!isNaN(newPrice)) setProducts(products.map(prod => prod.id === p.id ? {...prod, price: newPrice} : prod));
                     }} className="bg-blue-50 dark:bg-blue-900/30 text-blue-600 p-3 rounded-xl text-[10px] font-black uppercase">EDIT</button>
                     <button onClick={() => setProducts(products.map(prod => prod.id === p.id ? {...prod, stock: prod.stock + 10} : prod))} className="bg-slate-100 dark:bg-slate-700 px-4 py-3 rounded-xl text-[10px] font-black">+10</button>
                   </div>
                </div>
              ))}
            </div>
            <button onClick={() => {
              const name = prompt("Item Name:");
              const price = Number(prompt("Unit Price:"));
              const stock = Number(prompt("Starting Stock:"));
              if (name && !isNaN(price)) setProducts([...products, { id: crypto.randomUUID(), name, price, stock, minStock: lowStockThreshold }]);
            }} className="w-full bg-slate-900 dark:bg-white dark:text-slate-900 text-white py-6 rounded-[2.5rem] font-black uppercase shadow-2xl tracking-widest">New Product</button>
          </div>
        )}

        {activeTab === 'Insights' && isOwner && (
           <div className="space-y-8 animate-in slide-in-from-right-5">
             <h2 className="text-3xl font-black">Advisor</h2>
             <div className="p-10 bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-[3rem] shadow-2xl relative overflow-hidden">
                {isInsightLoading ? (
                  <div className="flex flex-col items-center py-10 gap-6">
                    <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
                    <p className="text-xs font-black uppercase tracking-widest opacity-80 animate-pulse">Computing Strategy...</p>
                  </div>
                ) : (
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-4 opacity-60">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></div>
                      <span className="text-[10px] font-black uppercase tracking-widest">Live AI Suggestions</span>
                    </div>
                    <p className="font-bold leading-relaxed text-lg whitespace-pre-wrap">{insights}</p>
                  </div>
                )}
             </div>
             <button onClick={fetchInsights} className="w-full bg-slate-100 dark:bg-slate-800 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg">Refresh Insights</button>
           </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white/95 dark:bg-dark-card/95 backdrop-blur-md p-5 flex justify-around no-print border-t border-slate-100 dark:border-slate-800 rounded-t-[2.5rem] shadow-[0_-10px_40px_rgba(0,0,0,0.1)] z-40">
        <NavButton active={activeTab === 'POS'} label="Sales" icon={<Icons.Cart />} onClick={() => setActiveTab('POS')} />
        
        {(isOwner || isCashier) && (
           <NavButton active={activeTab === 'History'} label="Ledger" icon={<Icons.History />} onClick={() => setActiveTab('History')} />
        )}
        
        {isOwner && (
          <>
            <NavButton active={activeTab === 'Inventory'} label="Items" icon={<Icons.Inventory />} onClick={() => setActiveTab('Inventory')} />
            <NavButton active={activeTab === 'Admin'} label="Setup" icon={<Icons.Admin />} onClick={() => setActiveTab('Admin')} />
            <NavButton active={activeTab === 'Insights'} label="AI" icon={<Icons.Insights />} onClick={() => setActiveTab('Insights')} />
          </>
        )}

        {(isCashier || isEmployee) && (
          <NavButton active={activeTab === 'Shift'} label="Shift" icon={<Icons.User />} onClick={() => setActiveTab('Shift')} />
        )}
      </nav>

      {showUndoToast && (
        <div className="fixed bottom-28 left-6 right-6 bg-slate-900 text-white px-6 py-5 rounded-3xl shadow-2xl z-50 flex justify-between items-center animate-in slide-in-from-bottom-10">
           <p className="text-[11px] font-black uppercase">{undoState?.message}</p>
           <button onClick={performUndo} className="bg-blue-600 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase active:scale-90">Undo</button>
        </div>
      )}

      <Calculator />

      {showReceipt && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-6 no-print animate-in fade-in duration-300">
           <div className="bg-white dark:bg-slate-900 p-10 rounded-[3rem] w-full max-w-sm text-center shadow-2xl animate-in zoom-in-95 duration-300">
              <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              </div>
              <h2 className="text-2xl font-black mb-1 uppercase tracking-tighter">Success</h2>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-8">{new Date(showReceipt.timestamp).toLocaleString()}</p>
              <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-3xl mb-8 space-y-2 text-left">
                {showReceipt.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-xs font-bold">
                    <span className="opacity-60">{item.quantity}x {item.name}</span>
                    <span className="font-black">{CURRENCY}{(item.price * item.quantity).toLocaleString()}</span>
                  </div>
                ))}
                <div className="pt-3 mt-1 border-t border-slate-200 dark:border-slate-700 flex justify-between">
                  <span className="font-black uppercase text-[10px] opacity-40">Total</span>
                  <span className="font-black text-blue-600">{CURRENCY}{showReceipt.total.toLocaleString()}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => window.print()} className="bg-slate-100 dark:bg-slate-800 p-5 rounded-2xl font-black uppercase text-[10px]">Print</button>
                <button onClick={() => setShowReceipt(null)} className="bg-blue-600 text-white p-5 rounded-2xl font-black uppercase text-[10px]">Done</button>
              </div>
           </div>
        </div>
      )}

      <style>{`
        @keyframes fly-v2 { 
          0% { transform: translate(var(--startX), var(--startY)) scale(1.5); opacity: 1; } 
          50% { transform: translate(calc(var(--startX) + (var(--endX) - var(--startX)) * 0.5), calc(var(--startY) - 150px)) scale(1.2); opacity: 1; }
          100% { transform: translate(var(--endX), var(--endY)) scale(0.3); opacity: 0; } 
        }
        .animate-fly-v2 { animation: fly-v2 var(--duration) cubic-bezier(0.34, 1.56, 0.64, 1) forwards; position: fixed; left: 0; top: 0; }
        .scroll-smooth-touch { -webkit-overflow-scrolling: touch; }
      `}</style>
    </div>
  );
};

const NavButton: React.FC<{ active: boolean; label: string; icon: React.ReactNode; onClick: () => void }> = ({ active, label, icon, onClick }) => (
  <button onClick={onClick} className={`flex flex-col items-center transition-all ${active ? 'text-blue-600 scale-110' : 'text-slate-400 opacity-60'}`}>
    <div className={`p-3 rounded-2xl mb-1 ${active ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>{icon}</div>
    <span className="text-[9px] font-black uppercase tracking-[0.1em]">{label}</span>
  </button>
);

export default App;