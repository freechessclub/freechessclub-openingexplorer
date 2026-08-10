// Copyright 2026 Free Chess Club.
// Use of this source code is governed by a GPL-style
// license that can be found in the LICENSE file.

export interface Piece {
  type: 'k' | 'q' | 'r' | 'b' | 'n' | 'p',
  color: 'w' | 'b'
}

/**
 * Represents a chess position as an 8x8 array of Piece objects.
 */
export class Position {
  private board: (Piece | null)[][];

  public static SQUARES = [
    'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
    'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
    'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
    'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
    'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
    'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
    'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
    'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1'
  ];

  constructor(fen?: string) {
    if(!fen)
      fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

    this.board = [];
    const rows = fen.split(' ')[0].split('/'); // Only take the board layout part of the FEN
    rows.forEach(row => {
      const boardRow = [];
      for(const char of row) {
        if(/\d/.test(char))
          boardRow.push(...Array(parseInt(char, 10)).fill(null));
        else {
          const color = char === char.toLowerCase() ? 'b' : 'w';
          const type = char.toLowerCase() as 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
          boardRow.push({ type, color });
        }
      }
      this.board.push(boardRow);
    });
  }

  public get(square: string): Piece | null {
    const file = square[0];
    const rank = square[1];
    const colIndex = file.charCodeAt(0) - 'a'.charCodeAt(0);
    const rowIndex = 8 - parseInt(rank, 10);
    return this.board[rowIndex][colIndex];
  }

  public set(square: string, piece: Piece | null) {
    const file = square[0];
    const rank = square[1];
    const colIndex = file.charCodeAt(0) - 'a'.charCodeAt(0);
    const rowIndex = 8 - parseInt(rank, 10);
    this.board[rowIndex][colIndex] = piece;
  }

  public remove(square: string) {
    this.set(square, null);
  }
}

/**
 * Convert rook-castling notation to standard, e.g. from e1h1 to e1g1
 */
export function rookCastlingToStandard(fen: string, move: any): any {
  const outMove = { ...move };
  
  if(!move.from)
    return outMove;
  
  const turnColor = splitFEN(fen).color;
  const from = move.from;
  const to = move.to;  

  const pos = new Position(fen);
  const piece = pos.get(from);
  if(!piece || piece.type !== 'k')
    return outMove;

  if(turnColor === 'w' && from === 'e1') {
    if(to === 'a1')
      outMove.to = 'c1';
    else if(to === 'h1')
      outMove.to = 'g1';
  }
  else if(turnColor === 'b' && from === 'e8') {
    if(to === 'a8')
      outMove.to = 'c8';
    else if(to === 'h8')
      outMove.to = 'g8';
  }

  return outMove;
}

export function legalEnPassant(fen: string): boolean {
  const splitFen = splitFEN(fen);
  const enPassant = splitFen.enPassant;
  const turnColor = splitFen.color;
  if(enPassant === '-')
    return false;

  const pos = new Position(fen);
  const fromRank = turnColor === 'b' ? +enPassant.charAt(1) + 1 : +enPassant.charAt(1) - 1;
  const file = enPassant.charAt(0);
  let leftFromSquare = null, rightFromSquare = null;
  if(file !== 'a') {
    const fromFile = String.fromCharCode(file.charCodeAt(0) - 1);
    const fromSquare = `${fromFile}${fromRank}`;
    const piece = pos.get(fromSquare);
    if(piece && piece.color === turnColor && piece.type === 'p') 
      leftFromSquare = fromSquare;
  }
  if(file !== 'h') {
    const fromFile = String.fromCharCode(file.charCodeAt(0) + 1);
    const fromSquare = `${fromFile}${fromRank}`;
    const piece = pos.get(fromSquare);
    if(piece && piece.color === turnColor && piece.type === 'p') 
      rightFromSquare = fromSquare;    
  }

  if(leftFromSquare || rightFromSquare) {
    const chess = new Chess(fen);
    if(leftFromSquare && chess.move({ from: leftFromSquare, to: enPassant }))
      return true;
    if(rightFromSquare && chess.move({ from: rightFromSquare, to: enPassant }))
      return true;
  }

  return false;
}

/**
 * Split a FEN into its component parts
 */
export function splitFEN(fen: string) {
  const words = fen.split(/\s+/);
  return {
    board: words[0],
    color: words[1],
    castlingRights: words[2],
    enPassant: words[3],
    plyClock: words[4],
    moveNo: words[5]
  };
}

/**
 * Create a FEN from an object containing its component parts
 */
export function joinFEN(obj: any): string {
  return Object.keys(obj).map(key => obj[key]).join(' ');
}