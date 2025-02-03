import type { Player } from "src/server/player";
import type { Client } from "../client";
import { ClientData } from "../client-data";
import { DeviceOS } from "../client-options";
import type { AnimatedImageData, PersonaPieces, PieceTintColors } from "./skin";
import * as skin from "./skin/Skin.json";
import { InputMode } from "@serenityjs/protocol";

export type Payload = {
	AnimatedImageData: AnimatedImageData[];
	ArmSize: string;
	CapeData: string;
	CapeId: string;
	CapeImageHeight: number;
	CapeImageWidth: number;
	CapeOnClassicSkin: boolean;
	ClientRandomId: number;
	CompatibleWithClientSideChunkGen: boolean;
	CurrentInputMode: number;
	DefaultInputMode: number;
	DeviceId: string;
	DeviceModel: string;
	DeviceOS: number;
	GameVersion: string;
	GuiScale: number;
	IsEditorMode: boolean;
	LanguageCode: string;
	MaxViewDistance: number;
	MemoryTier: number;
	OverrideSkin: boolean;
	PersonaPieces: PersonaPieces[];
	PersonaSkin: boolean;
	PieceTintColors: PieceTintColors[];
	PlatformOfflineId: string;
	PlatformOnlineId: string;
	PlatformType: number;
	PlayFabId: string;
	PremiumSkin: boolean;
	SelfSignedId: string;
	ServerAddress: string;
	SkinAnimationData: string;
	SkinColor: string;
	SkinGeometryDataEngineVersion: string;
	SkinData: string;
	SkinGeometryData: string;
	SkinId: string;
	SkinImageHeight: number;
	SkinImageWidth: number;
	SkinResourcePatch: string;
	ThirdPartyName: string;
	ThirdPartyNameOnly: boolean;
	TrustedSkin: boolean;
	UIProfile: number;
};

export const createDefaultPayload = (client: Client | Player): Payload => {
	return {
		AnimatedImageData: skin.skinData.AnimatedImageData as AnimatedImageData[],
		ArmSize: skin.skinData.ArmSize,
		CapeData: skin.skinData.CapeData,
		CapeId: skin.skinData.CapeId,
		CapeImageHeight: skin.skinData.CapeImageHeight,
		CapeImageWidth: skin.skinData.CapeImageWidth,
		CapeOnClassicSkin: skin.skinData.CapeOnClassicSkin,
		ClientRandomId: ClientData.generateId(),
		CompatibleWithClientSideChunkGen: false,
		CurrentInputMode: client.options.loginOptions.CurrentInputMode,
		DefaultInputMode: client.options.loginOptions.DefaultInputMode,
		DeviceId: ClientData.nextUUID(),
		DeviceModel: client.options.loginOptions.DeviceModel,
		DeviceOS: client.options.deviceOS ?? DeviceOS.NintendoSwitch,
		GameVersion: client.options?.version,
		GuiScale: 0,
		IsEditorMode: false,
		LanguageCode: "en_US",
		MaxViewDistance: client.options?.viewDistance,
		MemoryTier: 2,
		OverrideSkin: false,
		PersonaPieces: skin.skinData.PersonaPieces,
		PersonaSkin: skin.skinData.PersonaSkin,
		PieceTintColors: skin.skinData.PieceTintColors,
		PlatformOfflineId: ClientData.nextUUID().replace(/-/g, ""),
		PlatformOnlineId: ClientData.OnlineId(),
		PlatformType: 2,
		PlayFabId: ClientData.nextUUID().replace(/-/g, "").slice(0, 16),
		PremiumSkin: skin.skinData.PremiumSkin,
		SelfSignedId: ClientData.nextUUID(),
		ServerAddress: `${client.options.host}:${client.options.port}`,
		SkinAnimationData: skin.skinData.SkinAnimationData,
		SkinColor: skin.skinData.SkinColor,
		SkinGeometryDataEngineVersion: skin.skinData.SkinGeometryDataEngineVersion,
		SkinData: skin.skinData.SkinData,
		SkinGeometryData: skin.skinData.SkinGeometryData,
		SkinId: skin.skinData.SkinId,
		SkinImageHeight: skin.skinData.SkinImageHeight,
		SkinImageWidth: skin.skinData.SkinImageWidth,
		SkinResourcePatch: skin.skinData.SkinResourcePatch,
		ThirdPartyName: client.profile?.name || "Player",
		ThirdPartyNameOnly: false,
		TrustedSkin: skin.skinData.TrustedSkin,
		UIProfile: 0,
	};
};
const getRandomId = () => {
	return (
		Math.floor(Math.random() * Date.now() * Math.random() * 1000000) ^
		Date.now()
	);
};
