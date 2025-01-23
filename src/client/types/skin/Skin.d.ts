interface AnimatedImageData {
	AnimationExpression: number;
	Frames: number;
	Image: string;
	ImageHeight: number;
	ImageWidth: number;
	Type: number;
}

interface PersonaPieces {
	IsDefault: boolean;
	PackId: string;
	PieceId: string;
	PieceType: string;
	ProductId: string;
}

interface PieceTintColors {
	Colors: string[];
	PieceType: string;
}

export type { AnimatedImageData, PersonaPieces, PieceTintColors };
