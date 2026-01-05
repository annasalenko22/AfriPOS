
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Product, Sale, CartItem, PaymentMethod, AppTab } from './types';
import { Icons, CURRENCY, LOW_STOCK_THRESHOLD as DEFAULT_THRESHOLD } from './constants';
import { Calculator } from './components/Calculator';
import { getBusinessInsights } from './services/gemini';

const BUSINESS_NAME = 'AfriPOS';
const BUSINESS_PHONE = '+234 800 123 4567';

type StockFilter = 'ALL' | 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

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

        if (!('BarcodeDetector' in window)) {
          setError("Barcode detection requires a secure connection (HTTPS) and modern browser support.");
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
          } catch (e) {
            console.error("Detection error:", e);
          }
          requestAnimationFrame(scan);
        };
        requestAnimationFrame(scan);

      } catch (err) {
        setError("Camera access denied. Please check site permissions.");
        console.error(err);
      }
    };

    startCamera();

    return () => {
      isActive = false;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 bg-slate-950 z-[100] flex flex-col items-center justify-center p-6 backdrop-blur-md">
      <div className="relative w-full max-w-sm aspect-square bg-slate-900 rounded-[2.5rem] overflow-hidden border-8 border-white/10 shadow-2xl">
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
        <div className="absolute inset-0 border-[60px] border-black/40 pointer-events-none">
          <div className="w-full h-full border-2 border-blue-400 rounded-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-blue-400 shadow-[0_0_20px_rgba(96,165,250,1)] animate-scan-line"></div>
          </div>
        </div>
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-8 text-center">
            <p className="text-red-400 font-bold text-lg leading-tight">{error}</p>
          </div>
        )}
      </div>
      <p className="text-white/60 font-medium mt-8 text-sm uppercase tracking-widest">Position barcode within frame</p>
      <button onClick={onClose} className="mt-8 bg-white text-slate-900 px-12 py-4 rounded-2xl font-black active:scale-95 transition-all shadow-xl">CLOSE SCANNER</button>
      <style>{`
        @keyframes scan-line { 0% { transform: translateY(0); } 100% { transform: translateY(300px); } }
        .animate-scan-line { animation: scan-line 1.5s ease-in-out infinite; }
      `}</style>
    </div>
  );
};

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AppTab>('POS');
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showReceipt, setShowReceipt] = useState<Sale | null>(null);
  const [insights, setInsights] = useState<string>('Your AI business assistant is ready.');
  const [isInsightLoading, setIsInsightLoading] = useState(false);
  const [inventorySearchQuery, setInventorySearchQuery] = useState('');
  const [posSearchQuery, setPosSearchQuery] = useState('');
  const [posStockFilter, setPosStockFilter] = useState<StockFilter>('ALL');
  const [flyingItems, setFlyingItems] = useState<FlyingItem[]>([]);
  const [isCartBumping, setIsCartBumping] = useState(false);
  const [newProductImage, setNewProductImage] = useState<string | undefined>(undefined);
  const [isScanning, setIsScanning] = useState(false);
  const [scanningTarget, setScanningTarget] = useState<'POS' | 'INVENTORY'>('POS');
  const [formBarcode, setFormBarcode] = useState('');
  
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [showUndoToast, setShowUndoToast] = useState(false);
  // Fix: Use ReturnType<typeof setTimeout> instead of NodeJS.Timeout to resolve "Cannot find namespace 'NodeJS'" error in browser environments.
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
  
  const [animSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  
  useEffect(() => {
    const root = window.document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
      localStorage.setItem('afripos_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('afripos_theme', 'light');
    }
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('afripos_low_stock_threshold', lowStockThreshold.toString());
  }, [lowStockThreshold]);

  useEffect(() => {
    const savedProducts = localStorage.getItem('afripos_products');
    const savedSales = localStorage.getItem('afripos_sales');
    const savedCart = localStorage.getItem('afripos_cart');
    if (savedProducts) setProducts(JSON.parse(savedProducts));
    if (savedSales) setSales(JSON.parse(savedSales));
    if (savedCart) setCart(JSON.parse(savedCart));
  }, []);

  useEffect(() => { localStorage.setItem('afripos_products', JSON.stringify(products)); }, [products]);
  useEffect(() => { localStorage.setItem('afripos_sales', JSON.stringify(sales)); }, [sales]);
  useEffect(() => { localStorage.setItem('afripos_cart', JSON.stringify(cart)); }, [cart]);

  const fetchInsights = async () => {
    if (isInsightLoading) return;
    setIsInsightLoading(true);
    setInsights('Analyzing your business performance...');
    try {
      const text = await getBusinessInsights(products, sales);
      setInsights(text);
    } catch (err) {
      setInsights("Unable to reach AI advisor. Please try again.");
    } finally {
      setIsInsightLoading(false);
    }
  };

  useEffect(() => { if (activeTab === 'Insights') fetchInsights(); }, [activeTab]);

  const saveUndoSnapshot = (message: string) => {
    setUndoState({
      cart: JSON.parse(JSON.stringify(cart)),
      products: JSON.parse(JSON.stringify(products)),
      message
    });
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setNewProductImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const addProduct = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newProduct: Product = {
      id: crypto.randomUUID(),
      name: formData.get('name') as string,
      barcode: formBarcode || undefined,
      price: Number(formData.get('price')),
      stock: Number(formData.get('stock')),
      minStock: lowStockThreshold,
      image: newProductImage
    };
    setProducts([...products, newProduct]);
    setNewProductImage(undefined);
    setFormBarcode('');
    e.currentTarget.reset();
  };

  const restock = (id: string, amount: number) => {
    setProducts(products.map(p => p.id === id ? { ...p, stock: p.stock + amount } : p));
  };

  const addToCart = (product: Product, event?: React.MouseEvent) => {
    if (product.stock <= 0) return alert('Out of stock!');
    saveUndoSnapshot(`${product.name} added`);
    
    // Animation Logic
    let startX = window.innerWidth / 2, startY = window.innerHeight / 2;
    if (event) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      startX = rect.left + rect.width / 2;
      startY = rect.top + rect.height / 2;
    }
    const navItem = document.querySelector('nav button:first-child');
    const navRect = navItem?.getBoundingClientRect();
    const endX = navRect ? navRect.left + navRect.width / 2 : 50;
    const endY = navRect ? navRect.top + navRect.height / 2 : window.innerHeight - 50;
    const animationId = crypto.randomUUID();
    const durationMap = { slow: 1000, normal: 600, fast: 350 };
    const duration = durationMap[animSpeed];
    
    setFlyingItems(prev => [...prev, { id: animationId, startX, startY, endX, endY, duration }]);
    
    setTimeout(() => {
      setFlyingItems(prev => prev.filter(item => item.id !== animationId));
      setIsCartBumping(true);
      setTimeout(() => setIsCartBumping(false), 200);
    }, duration);

    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { ...product, quantity: 1 }];
    });
    setProducts(products.map(p => p.id === product.id ? { ...p, stock: p.stock - 1 } : p));
  };

  const handleBarcodeDetected = (code: string) => {
    setIsScanning(false);
    if (scanningTarget === 'INVENTORY') {
      setFormBarcode(code);
      return;
    }
    
    const product = products.find(p => p.barcode === code || p.id === code);
    if (product) addToCart(product);
    else if (window.confirm(`Product with code "${code}" not found. Go to Inventory to add?`)) {
      setActiveTab('Inventory');
      setInventorySearchQuery(code);
      setFormBarcode(code);
    }
  };

  const removeFromCart = (itemId: string) => {
    const item = cart.find(i => i.id === itemId);
    if (!item) return;
    saveUndoSnapshot(`${item.name} removed`);
    setCart(cart.filter(i => i.id !== itemId));
    setProducts(products.map(p => p.id === itemId ? { ...p, stock: p.stock + item.quantity } : p));
  };

  const updateQuantity = (itemId: string, delta: number) => {
    const item = cart.find(i => i.id === itemId);
    const product = products.find(p => p.id === itemId);
    if (!item || !product) return;
    
    const newQty = item.quantity + delta;
    if (newQty <= 0) { removeFromCart(itemId); return; }
    
    if (delta > 0 && product.stock <= 0) {
      alert(`No more stock for ${product.name}!`);
      return;
    }
    
    setCart(cart.map(i => i.id === itemId ? { ...i, quantity: newQty } : i));
    setProducts(products.map(p => p.id === itemId ? { ...p, stock: p.stock - delta } : p));
  };

  const handleCheckout = (method: PaymentMethod) => {
    if (cart.length === 0) return;
    const newSale: Sale = {
      id: crypto.randomUUID(),
      items: [...cart],
      total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
      paymentMethod: method,
      timestamp: Date.now()
    };
    setSales([newSale, ...sales]);
    setShowReceipt(newSale);
    setCart([]);
    setUndoState(null);
    setShowUndoToast(false);
  };

  const currentTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const filteredInventory = products.filter(p => 
    p.name.toLowerCase().includes(inventorySearchQuery.toLowerCase()) || 
    (p.barcode && p.barcode.includes(inventorySearchQuery))
  );
  
  const filteredPosProducts = useMemo(() => products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(posSearchQuery.toLowerCase()) || 
                         (p.barcode && p.barcode.includes(posSearchQuery));
    let matchesStock = true;
    if (posStockFilter === 'IN_STOCK') matchesStock = p.stock > lowStockThreshold;
    else if (posStockFilter === 'LOW_STOCK') matchesStock = p.stock > 0 && p.stock <= lowStockThreshold;
    else if (posStockFilter === 'OUT_OF_STOCK') matchesStock = p.stock <= 0;
    return matchesSearch && matchesStock;
  }), [products, posSearchQuery, posStockFilter, lowStockThreshold]);

  const dailySummaries = useMemo(() => {
    const groups: Record<string, { total: number; count: number; timestamp: number }> = {};
    sales.forEach(sale => {
      const d = new Date(sale.timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      if (!groups[d]) groups[d] = { total: 0, count: 0, timestamp: sale.timestamp };
      groups[d].total += sale.total;
      groups[d].count += 1;
    });
    return Object.entries(groups).sort((a, b) => b[1].timestamp - a[1].timestamp);
  }, [sales]);

  return (
    <div className="min-h-screen flex flex-col max-w-lg mx-auto bg-white dark:bg-dark-bg shadow-2xl relative pb-28 transition-colors duration-300">
      <div className="fixed inset-0 pointer-events-none z-[100] no-print overflow-hidden">
        {flyingItems.map(item => (
          <div key={item.id} className="absolute w-10 h-10 bg-blue-600 rounded-2xl shadow-xl flex items-center justify-center text-white text-xs font-black animate-fly-v2" style={{ '--startX': `${item.startX}px`, '--startY': `${item.startY}px`, '--endX': `${item.endX}px`, '--endY': `${item.endY}px`, '--duration': `${item.duration}ms` } as React.CSSProperties}>+1</div>
        ))}
      </div>

      {isScanning && <BarcodeScanner onDetected={handleBarcodeDetected} onClose={() => setIsScanning(false)} />}

      <header className="bg-blue-600 dark:bg-blue-800 text-white p-6 sticky top-0 z-40 flex justify-between items-center shadow-lg no-print transition-all rounded-b-[2rem]">
        <div className="flex flex-col">
          <h1 className="text-2xl font-black tracking-tighter leading-none">{BUSINESS_NAME}</h1>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">Smart Mobile POS</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-3 bg-white/10 rounded-2xl hover:bg-white/20 transition-all active:scale-90 shadow-inner">
            {isDarkMode ? <Icons.Sun /> : <Icons.Moon />}
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 overflow-y-auto scroll-smooth-touch">
        {activeTab === 'POS' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex justify-between items-center">
              <h2 className="text-3xl font-black text-slate-800 dark:text-white">Terminal</h2>
              <button onClick={() => { setScanningTarget('POS'); setIsScanning(true); }} className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white p-4 rounded-2xl shadow-xl active:scale-95 transition-all flex items-center gap-2">
                <Icons.Barcode />
                <span className="font-black text-xs uppercase tracking-wider">Scan</span>
              </button>
            </div>
            
            <div className={`bg-slate-50 dark:bg-dark-card p-6 rounded-[2.5rem] border-2 border-dashed border-slate-200 dark:border-slate-700 shadow-inner transition-all ${isCartBumping ? 'scale-[1.05] border-blue-500 bg-blue-50 dark:bg-blue-900/10' : ''}`}>
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-black text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 uppercase tracking-[0.2em]">
                  <Icons.Cart /> Basket ({cart.reduce((s, i) => s + i.quantity, 0)})
                </h3>
                {cart.length > 0 && <button onClick={() => { if(confirm('Clear entire basket?')) setCart([]); }} className="text-[10px] font-black text-red-500 uppercase">Clear</button>}
              </div>
              
              {cart.length === 0 ? (
                <div className="py-12 flex flex-col items-center text-center space-y-4 opacity-40">
                  <div className="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center">
                    <Icons.Cart />
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 font-bold text-sm">Basket is empty<br/><span className="text-xs font-medium">Select items below to start sale</span></p>
                </div>
              ) : (
                <div className="space-y-4">
                  {cart.map(item => (
                    <div key={item.id} className="flex justify-between items-center bg-white dark:bg-slate-800 p-3 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 transition-all">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        {item.image ? (
                          <img src={item.image} alt="" className="w-14 h-14 rounded-xl object-cover bg-slate-100 dark:bg-slate-700 shadow-sm" />
                        ) : (
                          <div className="w-14 h-14 rounded-xl bg-slate-50 dark:bg-slate-700 flex items-center justify-center text-slate-300 dark:text-slate-500 shadow-sm">
                            <Icons.Inventory />
                          </div>
                        )}
                        <div className="truncate">
                          <p className="font-black text-slate-900 dark:text-white truncate text-sm leading-tight">{item.name}</p>
                          <p className="text-[10px] text-blue-600 dark:text-blue-400 font-black uppercase mt-1">{CURRENCY}{(item.price * item.quantity).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 ml-4">
                        <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-600">
                          <button onClick={() => updateQuantity(item.id, -1)} className="w-10 h-10 flex items-center justify-center font-black text-xl text-blue-600 dark:text-blue-400 active:bg-blue-600 active:text-white transition-all">-</button>
                          <span className="px-1 text-center font-black text-sm text-slate-800 dark:text-white">{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.id, 1)} className="w-10 h-10 flex items-center justify-center font-black text-xl text-blue-600 dark:text-blue-400 active:bg-blue-600 active:text-white transition-all">+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="pt-6 border-t-2 border-slate-100 dark:border-slate-700 mt-4 flex justify-between items-end">
                    <span className="font-bold text-slate-400 text-xs uppercase tracking-widest">Total Payable</span>
                    <span className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{CURRENCY}{currentTotal.toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Inventory /></div>
                <input type="text" placeholder="Search by name or code..." value={posSearchQuery} onChange={(e) => setPosSearchQuery(e.target.value)} className="w-full p-5 pl-12 rounded-2xl border-2 border-slate-100 dark:border-slate-700 bg-white dark:bg-dark-card text-slate-900 dark:text-white focus:border-blue-500 outline-none font-bold shadow-md transition-all" />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
                {(['ALL', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const).map(f => (
                  <button key={f} onClick={() => setPosStockFilter(f)} className={`whitespace-nowrap px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all border-2 ${posStockFilter === f ? 'bg-blue-600 text-white border-blue-600 shadow-lg scale-105' : 'bg-white dark:bg-dark-card text-slate-500 dark:text-slate-400 border-slate-100 dark:border-slate-800'}`}>{f.replace('_',' ')}</button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pb-40">
              {filteredPosProducts.map(p => (
                <button key={p.id} onClick={(e) => addToCart(p, e)} disabled={p.stock <= 0} className={`group p-0 overflow-hidden rounded-[2rem] border-2 text-left transition-all active:scale-95 shadow-lg flex flex-col relative ${p.stock <= 0 ? 'bg-slate-100 dark:bg-slate-800 opacity-60 grayscale' : p.stock <= lowStockThreshold ? 'bg-orange-50 border-orange-200' : 'bg-white border-white dark:border-slate-800'}`}>
                  <div className={`absolute top-3 right-3 z-10 px-3 py-1.5 rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg ${p.stock <= lowStockThreshold ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-600 text-white'}`}>{p.stock} In Stock</div>
                  {p.image ? (
                    <div className="relative h-36 w-full overflow-hidden">
                      <img src={p.image} className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500" />
                    </div>
                  ) : (
                    <div className="h-36 w-full bg-slate-50 dark:bg-slate-700 flex items-center justify-center text-slate-200 dark:text-slate-600"><Icons.Inventory /></div>
                  )}
                  <div className="p-4 bg-white dark:bg-dark-card flex-1 flex flex-col justify-between">
                    <p className="font-black text-sm text-slate-800 dark:text-white line-clamp-2 leading-tight">{p.name}</p>
                    <p className="text-blue-600 dark:text-blue-400 font-black text-lg mt-3">{CURRENCY}{p.price.toLocaleString()}</p>
                  </div>
                </button>
              ))}
            </div>

            {cart.length > 0 && (
              <div className="fixed bottom-24 left-4 right-4 max-w-lg mx-auto bg-slate-900/90 dark:bg-white/95 backdrop-blur-xl p-5 rounded-[2.5rem] border border-white/10 z-50 no-print transition-all animate-in slide-in-from-bottom-12">
                 <div className="flex items-center justify-between mb-4 px-2">
                    <span className="text-white dark:text-slate-500 text-[10px] font-black uppercase tracking-[0.2em]">Select Payment</span>
                    <span className="text-blue-400 dark:text-blue-600 font-black text-lg">{CURRENCY}{currentTotal.toLocaleString()}</span>
                 </div>
                 <div className="grid grid-cols-3 gap-3">
                    <button onClick={() => handleCheckout(PaymentMethod.CASH)} className="bg-emerald-600 text-white font-black py-5 rounded-2xl active:scale-95 shadow-xl text-xs uppercase tracking-widest">Cash</button>
                    <button onClick={() => handleCheckout(PaymentMethod.MOBILE_MONEY)} className="bg-orange-500 text-white font-black py-5 rounded-2xl active:scale-95 shadow-xl text-xs uppercase tracking-widest">Mobile</button>
                    <button onClick={() => handleCheckout(PaymentMethod.BANK_TRANSFER)} className="bg-blue-600 text-white font-black py-5 rounded-2xl active:scale-95 shadow-xl text-xs uppercase tracking-widest">Bank</button>
                 </div>
              </div>
            )}
          </div>
        )}

        {showUndoToast && activeTab === 'POS' && (
          <div className="fixed bottom-28 left-6 right-6 max-w-md mx-auto flex items-center justify-between bg-slate-900 text-white px-6 py-4 rounded-[2rem] shadow-2xl z-[55] animate-in slide-in-from-bottom-10 fade-in duration-300">
            <p className="text-xs font-bold truncate pr-4">{undoState?.message}</p>
            <button onClick={performUndo} className="bg-blue-600 text-white px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider active:scale-90 transition-all">Undo</button>
          </div>
        )}

        {activeTab === 'Inventory' && (
          <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            <h2 className="text-3xl font-black text-slate-800 dark:text-white">Inventory</h2>
            <form onSubmit={addProduct} className="bg-slate-50 dark:bg-slate-800/50 p-8 rounded-[2.5rem] border-2 border-slate-100 dark:border-slate-700 space-y-6 shadow-inner">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Basic Info</label>
                <input name="name" placeholder="Item Name (e.g. Milk 1L)" className="w-full p-5 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none font-bold focus:border-blue-500 transition-all" required />
              </div>
              
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">ID / Barcode</label>
                <div className="relative group">
                  <input 
                    name="barcode" 
                    placeholder="Scan or enter code..." 
                    value={formBarcode}
                    onChange={(e) => setFormBarcode(e.target.value)}
                    className="w-full p-5 pr-16 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none font-bold focus:border-blue-500 transition-all" 
                  />
                  <button 
                    type="button"
                    onClick={() => { setScanningTarget('INVENTORY'); setIsScanning(true); }}
                    className="absolute right-3 top-3 bottom-3 aspect-square bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-xl flex items-center justify-center active:scale-90 transition-all shadow-md"
                  >
                    <Icons.Barcode />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Price</label>
                  <input name="price" type="number" placeholder="0.00" className="w-full p-5 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold outline-none focus:border-blue-500 transition-all" required />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Quantity</label>
                  <input name="stock" type="number" placeholder="0" className="w-full p-5 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold outline-none focus:border-blue-500 transition-all" required />
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Product Visual</label>
                <label className="flex flex-col items-center px-6 py-8 bg-white dark:bg-slate-900 text-blue-600 rounded-2xl border-2 border-dashed border-blue-200 dark:border-slate-700 cursor-pointer hover:bg-blue-50 transition-all shadow-sm">
                  <Icons.Inventory /><span className="text-xs font-bold mt-2 uppercase tracking-tighter">Upload Product Image</span><input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
              </div>
              
              {newProductImage && (
                <div className="relative w-24 h-24 mx-auto">
                  <img src={newProductImage} className="w-full h-full rounded-[1.5rem] object-cover border-4 border-white shadow-xl" />
                  <button onClick={() => setNewProductImage(undefined)} className="absolute -top-2 -right-2 bg-red-500 text-white w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shadow-lg">✕</button>
                </div>
              )}
              
              <button type="submit" className="w-full bg-blue-600 text-white font-black py-6 rounded-[2rem] shadow-xl hover:bg-blue-700 transition-all active:scale-95 text-sm uppercase tracking-widest border-t border-white/20">Initialize Product</button>
            </form>

            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-xs text-slate-400 uppercase tracking-[0.2em]">Current Inventory</h3>
                <span className="text-[10px] font-bold text-slate-400">{filteredInventory.length} Items Total</span>
              </div>
              {filteredInventory.map(p => (
                <div key={p.id} className="p-5 rounded-[2rem] border-2 border-slate-50 dark:border-slate-800 bg-white dark:bg-dark-card flex items-center justify-between shadow-sm group hover:shadow-xl transition-all hover:border-blue-100">
                  <div className="flex items-center gap-5">
                    {p.image ? (
                      <img src={p.image} className="w-14 h-14 rounded-2xl object-cover shadow-md" />
                    ) : (
                      <div className="w-14 h-14 rounded-2xl bg-slate-50 dark:bg-slate-700 flex items-center justify-center text-slate-300 dark:text-slate-500"><Icons.Inventory /></div>
                    )}
                    <div>
                      <p className="font-black text-slate-800 dark:text-white text-base leading-tight">{p.name}</p>
                      <div className="flex gap-3 mt-1">
                        <p className="text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase tracking-tighter">{p.stock} Units Left</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">{CURRENCY}{p.price.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => restock(p.id, 10)} className="bg-slate-50 dark:bg-slate-700 px-5 py-3 rounded-2xl font-black text-[10px] text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white transition-all active:scale-90">+10</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'History' && (
          <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            <h2 className="text-3xl font-black text-slate-800 dark:text-white">Ledger</h2>
            <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-600 rounded-full blur-[80px] opacity-30 group-hover:scale-150 transition-transform duration-1000"></div>
              <p className="text-[10px] font-black uppercase opacity-60 tracking-[0.3em] mb-2">Total Monthly Revenue</p>
              <p className="text-5xl font-black tracking-tighter">{CURRENCY}{sales.reduce((s,x)=>s+x.total,0).toLocaleString()}</p>
              <div className="mt-6 flex gap-4">
                <div className="flex flex-col">
                  <span className="text-[8px] font-black text-white/40 uppercase">Transactions</span>
                  <span className="text-xl font-bold">{sales.length}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] font-black text-white/40 uppercase">Avg. Ticket</span>
                  <span className="text-xl font-bold">{CURRENCY}{sales.length > 0 ? Math.round(sales.reduce((s,x)=>s+x.total,0)/sales.length).toLocaleString() : 0}</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-4">
              <h3 className="font-black text-xs text-slate-400 uppercase tracking-[0.2em] mb-6">Daily Breakdown</h3>
              {dailySummaries.map(([date, data]) => (
                <div key={date} className="bg-white dark:bg-dark-card p-6 rounded-[2rem] border-2 border-slate-50 dark:border-slate-800 flex justify-between items-center shadow-sm hover:shadow-lg transition-all">
                  <div>
                    <p className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-1">{date}</p>
                    <p className="text-2xl font-black text-slate-900 dark:text-white">{CURRENCY}{data.total.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{data.count} Sales Completed</p>
                    <div className="flex gap-1 justify-end mt-2">
                       <div className="w-1 h-3 bg-emerald-500 rounded-full"></div>
                       <div className="w-1 h-5 bg-emerald-500 rounded-full"></div>
                       <div className="w-1 h-2 bg-emerald-500 rounded-full"></div>
                       <div className="w-1 h-4 bg-emerald-500 rounded-full"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'Insights' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            <h2 className="text-3xl font-black text-slate-800 dark:text-white">AI Advisor</h2>
            <div className="bg-white dark:bg-dark-card p-10 rounded-[2.5rem] border-2 border-slate-100 dark:border-slate-800 space-y-8 shadow-xl relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-400 via-indigo-500 to-emerald-400"></div>
               {isInsightLoading && (
                 <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex flex-col items-center justify-center z-10 p-12 text-center">
                   <div className="w-20 h-20 relative mb-6">
                      <div className="absolute inset-0 border-4 border-blue-100 dark:border-slate-700 rounded-full"></div>
                      <div className="absolute inset-0 border-4 border-blue-600 rounded-full border-t-transparent animate-spin"></div>
                   </div>
                   <p className="font-black text-slate-800 dark:text-white text-lg">Synthesizing Business Intelligence...</p>
                   <p className="text-xs text-slate-400 mt-2">Comparing inventory status against recent sales trends</p>
                 </div>
               )}
               <div className="flex items-center gap-4 mb-2">
                  <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                    <Icons.Insights />
                  </div>
                  <div>
                    <h4 className="font-black text-sm uppercase tracking-widest text-slate-400">Merchant Analysis</h4>
                    <p className="text-[10px] font-bold text-blue-600 uppercase">Powered by Gemini AI</p>
                  </div>
               </div>
               <div className="text-base font-bold text-slate-700 dark:text-slate-200 leading-relaxed min-h-[120px] bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 whitespace-pre-wrap">
                 {insights}
               </div>
               <button onClick={fetchInsights} className="w-full bg-slate-900 dark:bg-white dark:text-slate-900 text-white font-black py-6 rounded-[2rem] shadow-2xl hover:scale-105 transition-all active:scale-95 uppercase text-xs tracking-[0.3em] flex items-center justify-center gap-3">
                 <Icons.Insights /> Generate New Analysis
               </button>
            </div>
            <p className="text-[10px] text-center text-slate-400 font-bold uppercase tracking-widest px-10 leading-relaxed">AI analysis works best with at least 5 products and several days of sales history.</p>
          </div>
        )}
      </main>

      <nav className="bg-white/90 dark:bg-dark-card/90 backdrop-blur-xl border-t border-slate-100 dark:border-slate-800 fixed bottom-0 left-0 right-0 max-w-lg mx-auto flex justify-around p-5 z-40 no-print transition-all rounded-t-[2.5rem] shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        <NavButton active={activeTab === 'POS'} label="Terminal" icon={<Icons.Cart />} onClick={() => setActiveTab('POS')} />
        <NavButton active={activeTab === 'Inventory'} label="Inventory" icon={<Icons.Inventory />} onClick={() => setActiveTab('Inventory')} />
        <NavButton active={activeTab === 'History'} label="Ledger" icon={<Icons.History />} onClick={() => setActiveTab('History')} />
        <NavButton active={activeTab === 'Insights'} label="Advisor" icon={<Icons.Insights />} onClick={() => setActiveTab('Insights')} />
      </nav>

      <Calculator />

      {showReceipt && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-end sm:items-center justify-center p-4 z-[70] no-print animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-20 duration-500">
            <div className="p-10 space-y-8 flex-1 overflow-y-auto">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-blue-600 text-white rounded-[1.5rem] flex items-center justify-center mx-auto mb-4 shadow-xl shadow-blue-500/20">
                  <Icons.Cart />
                </div>
                <h2 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter leading-none">{BUSINESS_NAME}</h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Transaction Success</p>
                <p className="text-xs font-bold text-slate-500">{BUSINESS_PHONE}</p>
              </div>
              
              <div className="border-y-2 border-dashed border-slate-100 dark:border-slate-800 py-6 space-y-4">
                {showReceipt.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center text-sm font-black text-slate-800 dark:text-slate-200">
                    <div className="flex flex-col">
                      <span>{item.name}</span>
                      <span className="text-[10px] opacity-40">{item.quantity} x {CURRENCY}{item.price.toLocaleString()}</span>
                    </div>
                    <span className="tracking-tighter">{CURRENCY}{(item.price * item.quantity).toLocaleString()}</span>
                  </div>
                ))}
              </div>
              
              <div className="text-center pt-2">
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.3em] mb-1">Total Paid via {showReceipt.paymentMethod}</p>
                <p className="text-6xl font-black text-slate-900 dark:text-white tracking-tighter">{CURRENCY}{showReceipt.total.toLocaleString()}</p>
              </div>
              <p className="text-[10px] text-center text-slate-400 font-bold italic">Thank you for your patronage!</p>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
              <button onClick={() => window.print()} className="bg-slate-900 dark:bg-white dark:text-slate-900 text-white p-5 rounded-[1.5rem] font-black text-xs uppercase tracking-widest active:scale-95 transition-all">Print</button>
              <button onClick={() => setShowReceipt(null)} className="bg-blue-600 text-white p-5 rounded-[1.5rem] font-black text-xs uppercase tracking-widest active:scale-95 transition-all">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Actual Print Layout */}
      <div className="print-only p-12 text-black font-mono bg-white">
        <div className="text-center mb-10 border-b-2 border-black pb-8">
          <h1 className="text-5xl font-bold mb-2 tracking-tighter">{BUSINESS_NAME}</h1>
          <p className="text-xl">Tel: {BUSINESS_PHONE}</p>
          <p className="text-sm mt-4">Date: {new Date().toLocaleString()}</p>
          <p className="text-sm">Receipt ID: {showReceipt?.id.split('-')[0].toUpperCase()}</p>
        </div>
        <div className="border-b-2 border-black mb-6 py-6 space-y-3">
          {showReceipt?.items.map((item, idx) => (
            <div key={idx} className="flex justify-between text-lg">
              <span>{item.quantity} x {item.name}</span>
              <span>{CURRENCY}{(item.price * item.quantity).toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-4xl font-black mb-10">
          <span>TOTAL</span>
          <span>{CURRENCY}{showReceipt?.total.toLocaleString()}</span>
        </div>
        <div className="text-center border-t border-black pt-8">
          <p className="text-lg font-bold">Paid by {showReceipt?.paymentMethod}</p>
          <p className="mt-4 italic">Thank you for shopping with us!</p>
        </div>
      </div>

      <style>{`
        @keyframes fly-v2 { 
          0% { transform: translate(var(--startX), var(--startY)) scale(1.5); opacity: 1; } 
          50% { transform: translate(calc(var(--startX) + (var(--endX) - var(--startX)) * 0.5), calc(var(--startY) - 150px)) scale(1.2); opacity: 1; }
          100% { transform: translate(var(--endX), var(--endY)) scale(0.3); opacity: 0; } 
        }
        .animate-fly-v2 { 
          animation: fly-v2 var(--duration) cubic-bezier(0.34, 1.56, 0.64, 1) forwards; 
          position: fixed; 
          left: 0; 
          top: 0; 
        }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>
    </div>
  );
};

const NavButton: React.FC<{ active: boolean; label: string; icon: React.ReactNode; onClick: () => void }> = ({ active, label, icon, onClick }) => (
  <button onClick={onClick} className={`flex flex-col items-center p-3 rounded-[1.5rem] transition-all relative ${active ? 'text-blue-600 dark:text-blue-400 scale-110' : 'text-slate-400 dark:text-slate-600 hover:text-slate-500'}`}>
    <div className={`${active ? 'bg-blue-50 dark:bg-blue-900/40 shadow-inner' : ''} p-3 rounded-2xl mb-1 transition-all`}>{icon}</div>
    <span className={`text-[9px] font-black uppercase tracking-widest ${active ? 'opacity-100' : 'opacity-40'}`}>{label}</span>
    {active && <div className="absolute -bottom-1 w-1 h-1 bg-blue-600 rounded-full"></div>}
  </button>
);

export default App;
