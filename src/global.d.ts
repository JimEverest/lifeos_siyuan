declare module "siyuan" {
  export class Plugin {
    loadData(key: string): Promise<unknown>;
    saveData(key: string, data: unknown): Promise<void>;
    addTopBar(opts: {
      icon: string;
      title: string;
      position?: string;
      callback: (event: MouseEvent) => void;
    }): HTMLElement;
    addStatusBar?(opts: { element: HTMLElement }): void;
  }

  export class Menu {
    addItem(opts: { label: string; icon?: string; click: () => void }): void;
    addSeparator(): void;
    open(opts: { x: number; y: number; isLeft?: boolean }): void;
  }
}

declare const siyuan: any;
