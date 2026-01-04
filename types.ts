
export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  minStock: number;
  image?: string;
  barcode?: string;
}

export interface CartItem extends Product {
  quantity: number;
}

export enum PaymentMethod {
  CASH = 'Cash',
  BANK_TRANSFER = 'Bank Transfer',
  MOBILE_MONEY = 'Mobile Money'
}

export interface Sale {
  id: string;
  items: CartItem[];
  total: number;
  paymentMethod: PaymentMethod;
  timestamp: number;
}

export type AppTab = 'POS' | 'Inventory' | 'History' | 'Insights';
