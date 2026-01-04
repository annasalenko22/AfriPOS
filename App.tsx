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
          video: { facingMode: 'environment' } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        if (!('BarcodeDetector' in window)) {
          setError("Native Barcode Detector not supported. Please use Chrome on Android.");
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
        setError("Unable to access camera. Please check permissions.");
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
    <div className="fixed inset-0 bg-black z-[100] flex flex-col items-center justify-center p-4">
      <div className="relative w-full max-w-sm aspect-square bg-gray-900 rounded-3xl overflow-hidden border-4 border-white/20">
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
        <div className="absolute inset-0 border-[40px] border-black/50 pointer-events-none">
          <div className="w-full h-full border-2 border-blue-500 rounded-lg relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.8)] animate-scan-line"></div>
          </div>
        </div>
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-8 text-center">
            <p className="text-red-400 font-bold">{error}</p>
          </div>
        )}
      </div>
      <button onClick={onClose} className="mt-12 bg-white text-black px-12 py-4 rounded-2xl font-black active:scale-95 transition-all shadow-xl">CANCEL</button>
      <style>{`
        @keyframes scan-line { 0% { transform: translateY(0); } 100% { transform: translateY(300px); } }
        .animate-scan-line { animation: scan-line 2s linear infinite; }
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
  const [insights, setInsights] = useState<string>('Loading business insights...');
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
  const undoTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [lowStockThreshold, setLowStockThreshold] = useState<number>(() => {
    const saved = localStorage.getItem('afripos_low_stock_threshold');
    return saved ? parseInt(saved) : DEFAULT_THRESHOLD;
  });
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('afripos_theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  
  const [animSpeed, setAnimSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [showAnimSettings, setShowAnimSettings] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [bulkRestockAmount, setBulkRestockAmount] = useState<number>(10);
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const [historyPaymentFilter, setHistoryPaymentFilter] = useState<PaymentMethod | 'ALL'>('ALL');
  
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
    setInsights('Analyzing current business data...');
    try {
      const text = await getBusinessInsights(products, sales);
      setInsights(text);
    } catch (err) {
      setInsights("Unable to reach AI advisor.");
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
    undoTimerRef.current = setTimeout(() => setShowUndoToast(false), 5000);
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

  const handleBulkRestock = () => {
    setProducts(products.map(p => selectedProductIds.includes(p.id) ? { ...p, stock: p.stock + bulkRestockAmount } : p));
    setSelectedProductIds([]);
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
    
    const product = products.find(p => p.barcode === code || p.id === code || p.name.toLowerCase() === code.toLowerCase());
    if (product) addToCart(product);
    else if (window.confirm(`Code "${code}" not found. Add manually?`)) {
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

  const setQuantity = (itemId: string, newQty: number) => {
    const item = cart.find(i => i.id === itemId);
    const product = products.find(p => p.id === itemId);
    if (!item || !product) return;
    if (newQty <= 0) { removeFromCart(itemId); return; }
    const diff = newQty - item.quantity;
    if (diff > 0 && product.stock < diff) {
      alert(`Only ${product.stock} more available!`);
      return;
    }
    saveUndoSnapshot(`${item.name} qty changed`);
    setCart(cart.map(i => i.id === itemId ? { ...i, quantity: newQty } : i));
    setProducts(products.map(p => p.id === itemId ? { ...p, stock: p.stock - diff } : p));
  };

  const updateQuantity = (itemId: string, delta: number) => {
    const item = cart.find(i => i.id === itemId);
    if (item) setQuantity(itemId, item.quantity + delta);
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
  const filteredInventory = products.filter(p => p.name.toLowerCase().includes(inventorySearchQuery.toLowerCase()) || (p.barcode && p.barcode.includes(inventorySearchQuery)));
  const filteredPosProducts = useMemo(() => products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(posSearchQuery.toLowerCase()) || (p.barcode && p.barcode.includes(posSearchQuery));
    let matchesStock = true;
    if (posStockFilter === 'IN_STOCK') matchesStock = p.stock > lowStockThreshold;
    else if (posStockFilter === 'LOW_STOCK') matchesStock = p.stock > 0 && p.stock <= lowStockThreshold;
    else if (posStockFilter === 'OUT_OF_STOCK') matchesStock = p.stock <= 0;
    return matchesSearch && matchesStock;
  }), [products, posSearchQuery, posStockFilter, lowStockThreshold]);

  const filteredSales = useMemo(() => sales.filter(sale => {
    const date = new Date(sale.timestamp).toISOString().split('T')[0];
    return (!historyStartDate || date >= historyStartDate) && (!historyEndDate || date <= historyEndDate) && (historyPaymentFilter === 'ALL' || sale.paymentMethod === historyPaymentFilter);
  }), [sales, historyStartDate, historyEndDate, historyPaymentFilter]);

  const dailySummaries = useMemo(() => {
    const groups: Record<string, { total: number; count: number; timestamp: number }> = {};
    filteredSales.forEach(sale => {
      const d = new Date(sale.timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      if (!groups[d]) groups[d] = { total: 0, count: 0, timestamp: sale.timestamp };
      groups[d].total += sale.total;
      groups[d].count += 1;
    });
    return Object.entries(groups).sort((a, b) => b[1].timestamp - a[1].timestamp);
  }, [filteredSales]);

  return (
    <div className="min-h-screen flex flex-col max-w-lg mx-auto bg-white dark:bg-dark-bg shadow-xl relative pb-24 transition-colors duration-300">
      <div className="fixed inset-0 pointer-events-none z-[100] no-print overflow-hidden">
        {flyingItems.map(item => (
          <div key={item.id} className="absolute w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-[10px] font-black animate-fly-v2" style={{ '--startX': `${item.startX}px`, '--startY': `${item.startY}px`, '--endX': `${item.endX}px`, '--endY': `${item.endY}px`, '--duration': `${item.duration}ms` } as React.CSSProperties}>+1</div>
        ))}
      </div>

      {isScanning && <BarcodeScanner onDetected={handleBarcodeDetected} onClose={() => setIsScanning(false)} />}

      <header className="bg-blue-600 dark:bg-blue-800 text-white p-4 sticky top-0 z-40 flex justify-between items-center shadow-md no-print transition-colors">
        <h1 className="text-xl font-black tracking-tight">{BUSINESS_NAME}</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAnimSettings(!showAnimSettings)} className={`p-2 rounded-full hover:bg-blue-700 transition-colors ${showAnimSettings ? 'bg-blue-700' : 'bg-blue-700/50'}`}><Icons.Insights /></button>
          <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2.5 bg-blue-700/50 dark:bg-blue-900/50 rounded-full hover:bg-blue-700 dark:hover:bg-blue-900 transition-all active:scale-90">{isDarkMode ? <Icons.Sun /> : <Icons.Moon />}</button>
        </div>
      </header>

      <main className="flex-1 p-4 overflow-y-auto">
        {activeTab === 'POS' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b-2 border-blue-50 dark:border-gray-800 pb-2">
              <h2 className="text-2xl font-black text-gray-800 dark:text-gray-100">New Sale</h2>
              <button onClick={() => { setScanningTarget('POS'); setIsScanning(true); }} className="bg-blue-600 text-white p-3 rounded-xl shadow-lg active:scale-95 transition-all flex items-center gap-2"><Icons.Barcode /><span className="font-black text-xs uppercase">Scan</span></button>
            </div>
            
            {/* Cart Summary with Thumbnails */}
            <div className={`bg-gray-50 dark:bg-dark-card p-4 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700 shadow-inner transition-all ${isCartBumping ? 'scale-[1.03] border-blue-500 bg-blue-50 dark:bg-blue-900/10' : ''}`}>
              <h3 className="font-black text-sm text-gray-600 dark:text-gray-400 mb-4 flex items-center gap-2 uppercase tracking-widest"><Icons.Cart /> Basket ({cart.reduce((s, i) => s + i.quantity, 0)})</h3>
              {cart.length === 0 ? (
                <p className="text-gray-400 italic text-sm text-center py-6">Your basket is empty.<br/>Tap items below or scan a barcode.</p>
              ) : (
                <div className="space-y-3">
                  {cart.map(item => (
                    <div key={item.id} className="flex justify-between items-center bg-white dark:bg-gray-800 p-2.5 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 transition-all hover:shadow-md">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="flex-shrink-0">
                          {item.image ? (
                            <img src={item.image} alt="" className="w-12 h-12 rounded-xl object-cover bg-gray-100 dark:bg-gray-700 border border-gray-100 dark:border-gray-600 shadow-sm" />
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-gray-50 dark:bg-gray-700 flex items-center justify-center text-gray-300 dark:text-gray-500 border border-gray-100 dark:border-gray-600 shadow-sm">
                              <Icons.Inventory />
                            </div>
                          )}
                        </div>
                        <div className="truncate">
                          <p className="font-black text-gray-900 dark:text-gray-100 truncate text-sm leading-tight">{item.name}</p>
                          <p className="text-[10px] text-blue-600 dark:text-blue-400 font-black uppercase tracking-wider">{CURRENCY}{(item.price * item.quantity).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        <div className="flex items-center bg-gray-50 dark:bg-gray-700 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                          <button onClick={() => updateQuantity(item.id, -1)} className="w-8 h-8 flex items-center justify-center font-black text-lg text-blue-600 dark:text-blue-400 active:bg-blue-600 active:text-white transition-colors">-</button>
                          <span className="w-8 text-center font-black text-xs text-gray-800 dark:text-gray-100">{item.quantity}</span>
                          <button onClick={() => updateQuantity(item.id, 1)} className="w-8 h-8 flex items-center justify-center font-black text-lg text-blue-600 dark:text-blue-400 active:bg-blue-600 active:text-white transition-colors">+</button>
                        </div>
                        <button onClick={() => removeFromCart(item.id)} className="text-gray-300 dark:text-gray-500 hover:text-red-500 p-1.5 transition-colors">✕</button>
                      </div>
                    </div>
                  ))}
                  <div className="pt-4 border-t-2 border-gray-100 dark:border-gray-700 mt-2 flex justify-between text-2xl font-black text-gray-900 dark:text-gray-100">
                    <span>Total:</span><span>{CURRENCY}{currentTotal.toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <input type="text" placeholder="Search products or scan..." value={posSearchQuery} onChange={(e) => setPosSearchQuery(e.target.value)} className="w-full p-4 pl-12 rounded-2xl border-2 border-gray-100 dark:border-gray-700 bg-white dark:bg-dark-card text-gray-900 dark:text-white focus:border-blue-500 outline-none font-bold shadow-sm transition-all" />
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {(['ALL', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const).map(f => (
                  <button key={f} onClick={() => setPosStockFilter(f)} className={`whitespace-nowrap px-4 py-2 rounded-full text-[10px] font-black uppercase transition-all border-2 ${posStockFilter === f ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white dark:bg-dark-card text-gray-500 dark:text-gray-400 border-gray-100 dark:border-gray-800'}`}>{f.replace('_',' ')}</button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pb-32">
              {filteredPosProducts.map(p => (
                <button key={p.id} onClick={(e) => addToCart(p, e)} disabled={p.stock <= 0} className={`p-0 overflow-hidden rounded-2xl border-2 text-left transition-all active:scale-95 shadow-sm flex flex-col relative ${p.stock <= 0 ? 'bg-gray-100 dark:bg-gray-800 opacity-50' : p.stock <= lowStockThreshold ? 'bg-orange-50 border-orange-200' : 'bg-white border-blue-50'}`}>
                  <div className={`absolute top-2 right-2 z-10 px-2 py-1 rounded-lg font-black text-[10px] ${p.stock <= lowStockThreshold ? 'bg-red-500 text-white' : 'bg-blue-600 text-white'}`}>{p.stock} STOCK</div>
                  {p.image ? <img src={p.image} className="h-28 w-full object-cover" /> : <div className="h-28 w-full bg-gray-50 dark:bg-gray-700 flex items-center justify-center text-gray-300"><Icons.Inventory /></div>}
                  <div className="p-3 bg-white dark:bg-dark-card flex-1">
                    <p className="font-black text-sm text-gray-800 dark:text-gray-100 line-clamp-2">{p.name}</p>
                    <p className="text-blue-600 font-black text-base mt-2">{CURRENCY}{p.price.toLocaleString()}</p>
                  </div>
                </button>
              ))}
            </div>

            {cart.length > 0 && (
              <div className="fixed bottom-20 left-0 right-0 max-w-lg mx-auto bg-white dark:bg-dark-card p-4 border-t-2 border-blue-600 z-40 no-print transition-colors">
                 <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => handleCheckout(PaymentMethod.CASH)} className="bg-green-600 text-white font-black py-4 rounded-xl active:scale-95">CASH</button>
                    <button onClick={() => handleCheckout(PaymentMethod.MOBILE_MONEY)} className="bg-yellow-500 text-black font-black py-4 rounded-xl active:scale-95">M-MONEY</button>
                    <button onClick={() => handleCheckout(PaymentMethod.BANK_TRANSFER)} className="bg-blue-600 text-white font-black py-4 rounded-xl active:scale-95">BANK</button>
                 </div>
              </div>
            )}
          </div>
        )}

        {showUndoToast && activeTab === 'POS' && (
          <div className="fixed bottom-24 left-4 right-4 max-w-lg mx-auto flex items-center justify-between bg-gray-900/90 dark:bg-white/90 text-white dark:text-gray-900 px-6 py-4 rounded-2xl shadow-2xl backdrop-blur-md z-[55] animate-in slide-in-from-bottom-10 fade-in duration-300">
            <p className="text-sm font-bold truncate">{undoState?.message}</p>
            <button onClick={performUndo} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-black text-xs active:scale-90 transition-all">UNDO</button>
          </div>
        )}

        {activeTab === 'Inventory' && (
          <div className="space-y-6 pb-20">
            <h2 className="text-2xl font-black text-gray-800 dark:text-gray-100">Inventory</h2>
            <form onSubmit={addProduct} className="bg-blue-50 dark:bg-blue-900/10 p-6 rounded-3xl border-2 border-blue-100 space-y-4">
              <input name="name" placeholder="Item Name" className="w-full p-4 rounded-xl border-2 border-gray-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none font-bold" required />
              
              <div className="relative group">
                <input 
                  name="barcode" 
                  placeholder="Barcode (Optional)" 
                  value={formBarcode}
                  onChange={(e) => setFormBarcode(e.target.value)}
                  className="w-full p-4 pr-16 rounded-xl border-2 border-gray-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none font-bold focus:border-blue-500 transition-all" 
                />
                <button 
                  type="button"
                  onClick={() => { setScanningTarget('INVENTORY'); setIsScanning(true); }}
                  className="absolute right-2 top-2 bottom-2 bg-blue-600 text-white px-3 rounded-lg flex items-center justify-center active:scale-90 transition-all"
                  title="Scan Barcode"
                >
                  <Icons.Barcode />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input name="price" type="number" placeholder="Price" className="p-4 rounded-xl border-2 border-gray-200 bg-white dark:bg-gray-800 font-bold" required />
                <input name="stock" type="number" placeholder="Stock" className="p-4 rounded-xl border-2 border-gray-200 bg-white dark:bg-gray-800 font-bold" required />
              </div>
              <label className="flex flex-col items-center px-4 py-4 bg-white dark:bg-gray-800 text-blue-600 rounded-xl border-2 border-dashed border-blue-200 cursor-pointer">
                <Icons.Inventory /><span className="text-xs font-bold mt-1">Upload Photo</span><input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
              {newProductImage && <img src={newProductImage} className="w-16 h-16 mx-auto rounded-xl object-cover border-2 border-blue-200" />}
              <button type="submit" className="w-full bg-blue-600 text-white font-black py-4 rounded-xl">SAVE PRODUCT</button>
            </form>
            <div className="space-y-2">
              {filteredInventory.map(p => (
                <div key={p.id} onClick={() => setSelectedProductIds(prev => prev.includes(p.id) ? prev.filter(i=>i!==p.id) : [...prev, p.id])} className={`p-4 rounded-2xl border-2 transition-all flex items-center justify-between cursor-pointer ${selectedProductIds.includes(p.id) ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-50 bg-white dark:bg-dark-card'}`}>
                  <div className="flex items-center gap-3">
                    {p.image ? <img src={p.image} className="w-10 h-10 rounded-lg object-cover" /> : <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-300"><Icons.Inventory /></div>}
                    <div><p className="font-black text-gray-800 dark:text-gray-100">{p.name}</p><p className="text-xs text-blue-600 font-bold">{p.stock} units @ {CURRENCY}{p.price}</p></div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); restock(p.id, 10); }} className="bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded-lg font-black text-blue-600">+10</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'History' && (
          <div className="space-y-6 pb-20">
            <h2 className="text-2xl font-black text-gray-800 dark:text-gray-100">Sales Log</h2>
            <div className="bg-blue-600 text-white p-6 rounded-3xl shadow-xl"><p className="text-[10px] font-black uppercase opacity-70 mb-1">Total Filtered Revenue</p><p className="text-3xl font-black">{CURRENCY}{filteredSales.reduce((s,x)=>s+x.total,0).toLocaleString()}</p></div>
            {dailySummaries.map(([date, data]) => (
              <div key={date} className="bg-white dark:bg-gray-800 p-4 rounded-2xl border-2 border-blue-50 flex justify-between items-center shadow-sm">
                <div><p className="text-[10px] font-black text-blue-600 uppercase">{date}</p><p className="text-lg font-black">{CURRENCY}{data.total.toLocaleString()}</p></div>
                <div className="text-right"><p className="text-[10px] font-bold text-gray-400 uppercase">{data.count} Sales</p></div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Insights' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-black text-gray-800 dark:text-gray-100">AI Business Insights</h2>
            <div className="bg-blue-50 dark:bg-blue-900/10 p-6 rounded-3xl border-2 border-blue-100 space-y-4 relative">
               {isInsightLoading && <div className="absolute inset-0 bg-white/50 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>}
               <div className="font-bold text-gray-700 dark:text-gray-200 leading-relaxed min-h-[120px]">{insights}</div>
               <button onClick={fetchInsights} className="w-full bg-blue-600 text-white font-black py-4 rounded-xl shadow-lg">REFRESH ADVISOR</button>
            </div>
          </div>
        )}
      </main>

      <nav className="bg-white dark:bg-dark-card border-t-2 border-gray-100 dark:border-gray-800 fixed bottom-0 left-0 right-0 max-w-lg mx-auto flex justify-around p-3 z-40 no-print transition-colors">
        <NavButton active={activeTab === 'POS'} label="Sell" icon={<Icons.Cart />} onClick={() => setActiveTab('POS')} />
        <NavButton active={activeTab === 'Inventory'} label="Stock" icon={<Icons.Inventory />} onClick={() => setActiveTab('Inventory')} />
        <NavButton active={activeTab === 'History'} label="Log" icon={<Icons.History />} onClick={() => setActiveTab('History')} />
        <NavButton active={activeTab === 'Insights'} label="AI" icon={<Icons.Insights />} onClick={() => setActiveTab('Insights')} />
      </nav>

      <Calculator />

      {showReceipt && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-[60] no-print backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 w-full max-w-sm rounded-[2rem] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-8 space-y-4 flex-1 overflow-y-auto">
              <div className="text-center"><h2 className="text-2xl font-black text-blue-600 uppercase">{BUSINESS_NAME}</h2><p className="text-xs font-bold text-gray-500">Tel: {BUSINESS_PHONE}</p></div>
              <div className="border-y-2 border-dashed border-gray-100 dark:border-gray-800 py-4 space-y-2">
                {showReceipt.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm font-bold text-gray-800 dark:text-gray-200"><span>{item.quantity}x {item.name}</span><span>{CURRENCY}{(item.price * item.quantity).toLocaleString()}</span></div>
                ))}
              </div>
              <div className="text-center pt-2"><p className="text-[10px] text-gray-400 font-black uppercase">Total Amount</p><p className="text-4xl font-black text-gray-900 dark:text-gray-100">{CURRENCY}{showReceipt.total.toLocaleString()}</p></div>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3 bg-gray-50 dark:bg-gray-800 border-t border-gray-100"><button onClick={() => window.print()} className="bg-black text-white p-4 rounded-xl font-black">Print</button><button onClick={() => setShowReceipt(null)} className="bg-blue-600 text-white p-4 rounded-xl font-black">Close</button></div>
          </div>
        </div>
      )}

      <div className="print-only p-8 text-black font-mono bg-white">
        <div className="text-center mb-6 border-b border-black pb-4"><h1 className="text-3xl font-bold">{BUSINESS_NAME}</h1><p className="text-lg">Tel: {BUSINESS_PHONE}</p></div>
        <div className="border-y border-black my-4 py-2">
          {showReceipt?.items.map((item, idx) => (
            <div key={idx} className="flex justify-between"><span>{item.quantity} x {item.name}</span><span>{CURRENCY}{(item.price * item.quantity).toLocaleString()}</span></div>
          ))}
        </div>
        <div className="flex justify-between text-2xl font-bold"><span>TOTAL</span><span>{CURRENCY}{showReceipt?.total.toLocaleString()}</span></div>
      </div>

      <style>{`
        @keyframes fly-v2 { 0% { transform: translate(var(--startX), var(--startY)) scale(1.5); opacity: 1; } 40% { transform: translate(calc(var(--startX) + (var(--endX) - var(--startX)) * 0.4), calc(var(--startY) + (var(--endY) - var(--startY)) * 0.1 - 100px)) scale(1.2); opacity: 1; } 100% { transform: translate(var(--endX), var(--endY)) scale(0.3); opacity: 0; } }
        .animate-fly-v2 { animation: fly-v2 var(--duration) cubic-bezier(0.42, 0, 0.58, 1) forwards; position: fixed; left: 0; top: 0; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>
    </div>
  );
};

const NavButton: React.FC<{ active: boolean; label: string; icon: React.ReactNode; onClick: () => void }> = ({ active, label, icon, onClick }) => (
  <button onClick={onClick} className={`flex flex-col items-center p-2 rounded-xl transition-all ${active ? 'text-blue-600 dark:text-blue-400 scale-110' : 'text-gray-400 dark:text-gray-600'}`}>
    <div className={`${active ? 'bg-blue-100 dark:bg-blue-900/30' : ''} p-2 rounded-xl mb-1 transition-all`}>{icon}</div>
    <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
  </button>
);

export default App;