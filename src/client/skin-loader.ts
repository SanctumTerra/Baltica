import * as fs from "node:fs";
import { PNG } from "pngjs";
import type { SkinData } from "./types/payload";

/**
 * Load a Minecraft Bedrock skin from a PNG file
 * @param pngPath - Path to the PNG skin file (64x64 or 64x32)
 * @returns SkinData object ready to use in client options
 *
 * @example
 * ```typescript
 * import { Client, loadSkinFromPNG } from 'baltica';
 *
 * const client = new Client({
 *     address: "play.example.com",
 *     port: 19132,
 *     skinData: loadSkinFromPNG('./my-skin.png')
 * });
 * ```
 */
export function loadSkinFromPNG(pngPath: string): SkinData {
	// Read and parse PNG file
	const pngData = fs.readFileSync(pngPath);
	const png = PNG.sync.read(pngData);

	// Validate dimensions
	if (png.width !== 64 || (png.height !== 64 && png.height !== 32)) {
		throw new Error(
			`Invalid skin dimensions: ${png.width}x${png.height}. Expected 64x64 or 64x32`,
		);
	}

	// Convert RGBA pixel data to base64
	const base64Skin = png.data.toString("base64");

	// Create skin resource patch for standard humanoid model
	const resourcePatch = {
		geometry: {
			default: "geometry.humanoid.custom",
		},
	};

	return {
		AnimatedImageData: [],
		ArmSize: "wide",
		CapeData: "",
		CapeId: "",
		CapeImageHeight: 0,
		CapeImageWidth: 0,
		CapeOnClassicSkin: false,
		PersonaPieces: [],
		PersonaSkin: false,
		PieceTintColors: [],
		PremiumSkin: false,
		SkinAnimationData: "",
		SkinColor: "#0",
		SkinData: base64Skin,
		SkinGeometryData: "",
		SkinGeometryDataEngineVersion: "",
		SkinId: `custom_skin_${Date.now()}`,
		SkinImageHeight: png.height,
		SkinImageWidth: png.width,
		SkinResourcePatch: Buffer.from(JSON.stringify(resourcePatch)).toString(
			"base64",
		),
		TrustedSkin: true,
	} as SkinData;
}

/**
 * Load a Minecraft Bedrock skin from raw RGBA buffer
 * @param buffer - Raw RGBA pixel data buffer
 * @param width - Skin width (typically 64)
 * @param height - Skin height (typically 64 or 32)
 * @returns SkinData object ready to use in client options
 *
 * @example
 * ```typescript
 * import { Client, loadSkinFromBuffer } from 'baltica';
 *
 * const rgbaBuffer = Buffer.from([...]); // Your RGBA data
 * const client = new Client({
 *     address: "play.example.com",
 *     port: 19132,
 *     skinData: loadSkinFromBuffer(rgbaBuffer, 64, 64)
 * });
 * ```
 */
export function loadSkinFromBuffer(
	buffer: Buffer,
	width: number,
	height: number,
): SkinData {
	// Validate dimensions
	if (width !== 64 || (height !== 64 && height !== 32)) {
		throw new Error(
			`Invalid skin dimensions: ${width}x${height}. Expected 64x64 or 64x32`,
		);
	}

	// Validate buffer size (RGBA = 4 bytes per pixel)
	const expectedSize = width * height * 4;
	if (buffer.length !== expectedSize) {
		throw new Error(
			`Invalid buffer size: ${buffer.length} bytes. Expected ${expectedSize} bytes for ${width}x${height} RGBA`,
		);
	}

	// Convert to base64
	const base64Skin = buffer.toString("base64");

	// Create skin resource patch
	const resourcePatch = {
		geometry: {
			default: "geometry.humanoid.custom",
		},
	};

	return {
		AnimatedImageData: [],
		ArmSize: "wide",
		CapeData: "",
		CapeId: "",
		CapeImageHeight: 0,
		CapeImageWidth: 0,
		CapeOnClassicSkin: false,
		PersonaPieces: [],
		PersonaSkin: false,
		PieceTintColors: [],
		PremiumSkin: false,
		SkinAnimationData: "",
		SkinColor: "#0",
		SkinData: base64Skin,
		SkinGeometryData: "",
		SkinGeometryDataEngineVersion: "",
		SkinId: `custom_skin_${Date.now()}`,
		SkinImageHeight: height,
		SkinImageWidth: width,
		SkinResourcePatch: Buffer.from(JSON.stringify(resourcePatch)).toString(
			"base64",
		),
		TrustedSkin: true,
	} as SkinData;
}
