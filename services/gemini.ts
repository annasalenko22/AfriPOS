import { GoogleGenAI } from "@google/genai";
import { Product, Sale } from "../types";

export const getBusinessInsights = async (products: Product[], sales: Sale[]): Promise<string> => {
  // Always create a fresh instance to ensure the most up-to-date API key is used
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  // Optimize payload to prevent 500/RPC errors (error code 6 often relates to payload size/timeouts)
  const summarizedInventory = products
    .slice(0, 30) // Limit to top 30 products to avoid huge JSON strings
    .map(p => ({ 
      n: p.name, 
      s: p.stock, 
      p: p.price,
      l: p.stock < p.minStock ? 'LOW' : 'OK'
    }));

  const summarizedSales = sales
    .slice(0, 10) // Only send the 10 most recent sales
    .map(s => ({ 
      t: s.total, 
      m: s.paymentMethod 
    }));

  const prompt = `
    Context: A small retail business in Africa.
    Inventory Summary (n=name, s=stock, p=price, l=status): ${JSON.stringify(summarizedInventory)}
    Recent Sales (t=total, m=method): ${JSON.stringify(summarizedSales)}
    
    Task: Provide 3 short, highly actionable bullet points for this merchant to increase profit or manage stock better. 
    Focus on items marked 'LOW' or sales trends. Keep it extremely concise and encouraging.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text || "No insights available yet. Keep selling to generate more data!";
  } catch (error: any) {
    console.error("Gemini Insights Error:", error);
    // Graceful fallback for the user
    if (error?.message?.includes('429')) return "You're doing great! AI insights are currently busy, please check back in a moment.";
    return "Keep up the hard work! Remember to check your low-stock items and keep your customers happy.";
  }
};