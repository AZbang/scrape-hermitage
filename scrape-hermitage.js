const download = require("image-downloader");
const request = require("request-promise");
const cheerio = require("cheerio");
const mkdirp = require("mkdirp");
const fs = require("fs");

const museums = require("./museums.json");

const ITEM_TYPES = /.+/;
const SCRAPE_DIR = "static/";
const DB_HERMITAGE = "https://pano.hermitagemuseum.org/";
const TIMEOUT = 10000;
const REQUEST_AWAIT = 3000;
const REQUEST_COUNTS = 20;
const TABS = 0;

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

// UTILS
const getData = (url) => {
  return request({
    uri: url,
    timeout: TIMEOUT,
    transform: (body) =>
      cheerio.load(body, {
        normalizeWhitespace: true,
        xmlMode: true,
      }),
  });
};

const timeout = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// PARSE DATA
const parseRoomNav = (src) => {
  src = src.replace(/\/+$/, "");

  const navs = src.split("/").pop().split("_");
  const room = parseInt(navs[2].slice(1));
  const floor = parseInt(navs[1].slice(1));

  return { room, floor };
};

const getMuseum = (id) => {
  return museums.filter((m) => m.id === id)[0].request;
};

const getItemMeta = (src) => {
  src = src.replace(/\/+$/, "");

  return {
    id: parseInt(src.split("/").pop()),
    type: src.split("/")[src.split("/").length - 2],
  };
};

const getRoomUrl = ($room) => {
  return $room.find("userdata").attr("source");
};

const getHotspotsRoom = ($room) => {
  const items = [],
    links = [];
  $room.find("hotspot").each((i, point) => {
    if (point.attribs.skinid === "woa_info") {
      const src = point.attribs.description;
      if (src.search(ITEM_TYPES) != -1) items.push(src);
    } else if (point.attribs.skinid === "ht_node") {
      links.push(point.attribs.url.slice(1, -1));
    }
  });

  return { items, links };
};

const getRoomByHotspot = ($hotspot) => {
  return parseRoomNav($hotspot.parent().prev().attr("source")).room;
};

// LOAD DATA
const getItem = async (src) => {
  try {
    const $ = await getData(DB_HERMITAGE + src);
    if ($(".error-message").text()) return null;
    else if (!$(".content-title").text()) throw Error();

    const meta = getItemMeta(src);
    const table = [];
    $(".field-value").each((i, value) => {
      table.push($(value).text());
    });

    return {
      id: meta.id,
      type: meta.type,
      title: $(".content-title").text().replace("&nbsp;", ""),
      original_image: $(".image-popup").attr("href"),
      description: $(".cell-description").text(),
      category: table[0],
      author: table[1],
      country: table[2],
      created: table[3],
    };
  } catch (e) {
    await timeout(TIMEOUT);
    const data = await getItem(src);
    return data;
  }
};

const getRoom = async (src) => {
  try {
    const $ = await getData(DB_HERMITAGE + src);
    if ($(".error-message").text()) return null;
    else if (!$(".content-title").text()) throw Error();

    const nav = parseRoomNav(src);

    return {
      id: nav.room,
      floor: nav.floor,
      title: $(".content-title").text().replace("&nbsp;", ""),
      description: $(".popupScroller").text(),
    };
  } catch (e) {
    await timeout(TIMEOUT);
    const data = await getRoom(src);
    return data;
  }
};

const getImage = async (src, filename) => {
  try {
    await download.image({ timeout: TIMEOUT, url: src, dest: filename });
    return filename;
  } catch (e) {
    await timeout(TIMEOUT);
    const data = await getImage(src, filename);
    return data;
  }
};

// SCRAPING
const scrapeImages = async (dirMuseum, items) => {
  const promises = [];
  let progress = 0;

  items = items.filter((item) => item.original_image != null);

  items.forEach((item, i) =>
    promises.push(
      (async () => {
        await timeout(REQUEST_AWAIT * Math.floor(i / REQUEST_COUNTS));

        const path = dirMuseum + "/items/" + item.id + ".jpg";
        await getImage(item.original_image, path);

        console.log(
          `SUCCESS IMAGE ${item.id} | PROGRESS: ${++progress}/${items.length}`
        );
        return path;
      })()
    )
  );

  const pathes = await Promise.all(promises);
  console.log("Total images " + pathes.length);
  return pathes;
};

const scrapeItems = async (dirMuseum, museumId) => {
  const $ = await getData(getMuseum(museumId));
  const promises = [];
  const total = $('hotspot[skinid="woa_info"]').length;
  let progress = 0;

  $('hotspot[skinid="woa_info"]').each((i, $hotspot) =>
    promises.push(
      (async () => {
        await timeout(REQUEST_AWAIT * Math.floor(i / REQUEST_COUNTS));

        const src = $hotspot.attribs.description;
        if (src.search(ITEM_TYPES) == -1) return;

        const item = await getItem(src);
        if (!item) return;

        item.room = getRoomByHotspot($($hotspot));
        item.image = dirMuseum + "/items/" + item.id + ".jpg";

        console.log(
          `SUCCESS ITEM ${item.id} | PROGRESS: ${++progress}/${total}`
        );
        return item;
      })()
    )
  );

  let items = await Promise.all(promises);
  items = items.filter((item) => item != null);
  fs.writeFileSync(
    dirMuseum + "/items.json",
    JSON.stringify(items, null, TABS)
  );

  console.log("Total items " + items.length);
  return items;
};

const scrapeRooms = async (dirMuseum, museumId) => {
  const $ = await getData(getMuseum(museumId));
  const promises = [];
  const total = $("panorama").length;
  let progress = 0;

  $("panorama").each((i, $room) =>
    promises.push(
      (async () => {
        await timeout(REQUEST_AWAIT * Math.floor(i / REQUEST_COUNTS));

        // get hotspots
        const hotspots = getHotspotsRoom($($room));
        if (!hotspots.items.length) return;

        // get room data
        const roomUrl = getRoomUrl($($room));
        const room = await getRoom(roomUrl);
        if (!room) return;

        room.links = hotspots.links.map((node) => {
          const url = getRoomUrl($(`panorama[id="${node}"]`));
          return parseRoomNav(url).room;
        });
        room.items = hotspots.items.map((url) =>
          parseInt(url.split("/").pop())
        );

        console.log(
          `SUCCESS ROOM ${room.id} | PROGRESS: ${++progress}/${total}`
        );
        return room;
      })()
    )
  );

  let rooms = await Promise.all(promises);
  rooms = rooms.filter((room) => room != null);
  fs.writeFileSync(
    dirMuseum + "/rooms.json",
    JSON.stringify(rooms, null, TABS)
  );

  console.log("Total rooms " + rooms.length);
  return rooms;
};

const scrapeMuseum = async (
  museumId,
  { isRooms = true, isItems = true, isImages = true }
) => {
  const dirMuseum = SCRAPE_DIR + "hermitage_" + museumId;
  console.log("Scraping " + museumId + " hermitage building is started!");

  mkdirp.sync(dirMuseum);

  if (isRooms) {
    await scrapeRooms(dirMuseum, museumId);
  }

  if (isItems) {
    await scrapeItems(dirMuseum, museumId);
  }

  if (isImages) {
    const items = JSON.parse(fs.readFileSync(dirMuseum + "/items.json"));
    mkdirp.sync(dirMuseum + "/items");
    await scrapeImages(dirMuseum, items);
  }

  console.log("Scraping " + museumId + " hermitage building is completed!");
};

const scrapeMuseums = async (gets = {}) => {
  fs.writeFileSync(
    SCRAPE_DIR + "/museums.json",
    JSON.stringify(museums, null, TABS)
  );
  for (const museum of museums) {
    await scrapeMuseum(museum.id, gets);
  }
};

module.exports = {
  scrapeImages,
  scrapeItems,
  scrapeRooms,
  scrapeMuseum,
  scrapeMuseums,
};
