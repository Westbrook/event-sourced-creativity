import type { ColorValue, TokenType } from './types.js';
export declare class TokenError extends Error {
    readonly code: string;
    readonly tokenId?: string | undefined;
    constructor(code: string, message: string, tokenId?: string | undefined);
}
export declare const isRecord: (value: unknown) => value is Record<string, unknown>;
export declare const finite: (value: unknown) => value is number;
export declare function clone<T>(value: T): T;
export declare function deepFreeze<T>(value: T): T;
export declare function aliasTarget(value: unknown): string | undefined;
export declare function cssName(id: string): string;
export declare function validateValue(type: TokenType, value: unknown, id?: string): void;
export declare const numberText: (v: number) => string;
export declare function colorCSS(value: ColorValue): string;
export declare function valueCSS(type: TokenType, value: unknown): string;
