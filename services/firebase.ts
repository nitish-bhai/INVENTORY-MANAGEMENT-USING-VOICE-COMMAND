

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, doc, addDoc, updateDoc, deleteDoc, onSnapshot, Unsubscribe, setDoc, getDoc } from 'firebase/firestore';
import type { InventoryItem } from '../types';
import type { User } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDWBos5f3koVvfnJ5otTvHVIzD4QDGNvjU",
  authDomain: "studio-8371121982-c36f9.firebaseapp.com",
  projectId: "studio-8371121982-c36f9",
  storageBucket: "studio-8371121982-c36f9.firebasestorage.app",
  messagingSenderId: "939482534019",
  appId: "1:939482534019:web:0ef3816f1c10398559cbb6"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const getInventoryCollection = (userId: string) => collection(db, 'users', userId, 'inventory');

export const listenToInventory = (userId: string, callback: (items: InventoryItem[]) => void): Unsubscribe => {
  const inventoryCollection = getInventoryCollection(userId);
  return onSnapshot(inventoryCollection, (snapshot) => {
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
    callback(items);
  });
};

export const findItemByName = async (userId: string, name: string): Promise<InventoryItem | null> => {
    const inventoryCollection = getInventoryCollection(userId);
    const q = query(inventoryCollection, where("name", "==", name.toLowerCase()));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        return { id: doc.id, ...doc.data() } as InventoryItem;
    }
    return null;
}

export const getItemDetails = async (userId: string, name: string): Promise<string> => {
    const item = await findItemByName(userId, name);
    if (item) {
        return `${item.name} is in stock. Quantity: ${item.quantity}, Price per item: ₹${(item.pricePerItem || 0).toFixed(2)}.`;
    }
    return `Sorry, I could not find ${name} in your inventory.`;
};

export const getInventorySummary = async (userId: string): Promise<string> => {
    const inventoryCollection = getInventoryCollection(userId);
    const snapshot = await getDocs(inventoryCollection);
    if (snapshot.empty) {
        return "Your inventory is currently empty.";
    }
    const items = snapshot.docs.map(doc => doc.data() as Omit<InventoryItem, 'id'>);
    if (items.length === 0) {
        return "Your inventory is currently empty.";
    }

    const summary = items.map(item => `${item.quantity} ${item.name}`).join(', ');
    const totalItems = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    
    return `You have ${totalItems} total items in your inventory. They are: ${summary}.`;
};


export const addItem = async (userId: string, item: { name: string; quantity: number; pricePerItem: number; }): Promise<string> => {
    const existingItem = await findItemByName(userId, item.name);
    if (existingItem) {
        const itemRef = doc(db, 'users', userId, 'inventory', existingItem.id);
        const newQuantity = (existingItem.quantity || 0) + item.quantity;
        await updateDoc(itemRef, { quantity: newQuantity, pricePerItem: item.pricePerItem });
        return `Updated ${item.name} quantity to ${newQuantity}.`;
    } else {
        await addDoc(getInventoryCollection(userId), { ...item, name: item.name.toLowerCase() });
        return `Added ${item.quantity} of ${item.name}.`;
    }
};

export const removeItem = async (userId: string, itemName: string, quantity: number): Promise<string> => {
    const existingItem = await findItemByName(userId, itemName);
    if (!existingItem) {
        return `Item ${itemName} not found in inventory.`;
    }
    const itemRef = doc(db, 'users', userId, 'inventory', existingItem.id);
    const newQuantity = (existingItem.quantity || 0) - quantity;
    if (newQuantity <= 0) {
        await deleteDoc(itemRef);
        return `Removed all ${itemName} from inventory.`;
    } else {
        await updateDoc(itemRef, { quantity: newQuantity });
        return `Removed ${quantity} of ${itemName}. New quantity is ${newQuantity}.`;
    }
}