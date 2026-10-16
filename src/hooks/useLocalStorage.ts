import { useState, useEffect, useCallback } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        setStoredValue((prev) => {
          const valueToStore = value instanceof Function ? value(prev) : value;
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
          return valueToStore;
        });
      } catch (error) {
        console.error(`Error writing localStorage key "${key}":`, error);
      }
    },
    [key]
  );

  useEffect(() => {
    try {
      const existing = window.localStorage.getItem(key);
      if (existing === null) {
        window.localStorage.setItem(key, JSON.stringify(storedValue));
      }
    } catch {
      // ignore storage quota errors
    }
  }, [key, storedValue]);

  return [storedValue, setValue];
}
