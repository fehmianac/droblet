namespace Domain.Enum;

// E8 — store / content
public enum PriceBand { HighStreet, LuxuryTouch }

public enum ProductCategory
{
    Tshirt, Shirt, Blouse, Knitwear, Sweatshirt, Jacket, Coat, Trousers, Jeans, Skirt, Shorts, Dress,
    Shoes, Bag, Accessory, Swimwear, Skiwear, Activewear,
}

/// <summary>Outfit position a catalog category fills (screen 23: Üst, Alt, Dış giyim, Ayakkabı, Çanta).</summary>
public enum ProductSlot { Top, Bottom, Outerwear, Shoes, Bag, OnePiece, Accessory }

public enum ContentCollectionKind { Creator, Series }

/// <summary>Where a look referenced by a cart line / click / conversion lives.</summary>
public enum LookRefKind { Edit, Collection, User }

public enum WardrobePromptStatus { None, Pending, Accepted, Dismissed }

/// <summary>How a product got on the watch list: the user's own tap, or the 48-hour "no purchase after the brand visit" rule.</summary>
public enum WatchOrigin { User, Auto }

// E9 — social
public enum ShareChannel { Whatsapp, Pinterest, Link }

public enum ShareTargetKind { App, Profile, Look, Product, Edit }

public enum ReportReason { Spam, Inappropriate, Harassment, Impersonation, MinorSafety, Other }

public enum ReportTargetKind { Profile, Look, Item }

public enum ReportStatus { Open, Resolved }

public enum ReportResolution { Dismissed, ContentRemoved, UserWarned, UserSuspended }

// E11 — settings
public enum DevicePlatform { Ios, Android }

// Weather
public enum WeatherCondition { Clear, PartlyCloudy, Cloudy, Fog, Drizzle, Rain, Snow, Showers, Thunderstorm, Unknown }
