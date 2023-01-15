// https://en.wikipedia.org/wiki/List_of_file_signatures
const zipMagicBytes = [0x50, 0x4B, 0x03, 0x04];
const isZipFile = hasMagicBytes(zipMagicBytes);

const gzMagicBytes = [0x1F, 0x8B, 0x08];
const isGzFile = hasMagicBytes(gzMagicBytes);

// starts with "WARC""
const warcMagicBytes = [0x57, 0x41, 0x52, 0x43];
const isWarcFile = hasMagicBytes(warcMagicBytes);

const PEEK_BYTES = 4;

// todo: improve this to do full detection of different text types
function detectTextType(bytes) {
  try {
    const text = new TextDecoder().decode(bytes);
    const lines = text.split("\n");

    if (lines > 1 && lines.indexOf(" {")) {
      return ".cdxj";
    }
  } catch (e) {
    return "";
  }
}

function hasMagicBytes(magicBytes) {
  return fileBytes => {
    for (const [index, value] of magicBytes.entries()) {
      if (value !== fileBytes[index]) {
        return false;
      }
    }
    return true;
  };
}

export function getKnownFileExtension(name) {
  const fileExtensions = [
    ".warc",
    ".warc.gz",
    ".cdx",
    ".cdxj",
    ".har",
    ".json",
    ".wacz",
    ".zip"
  ];
  for (const ext of fileExtensions) {
    if (name.endsWith(ext)) {
      return ext;
    }
  }
  return "";
}

export function checkMagicBytes(fileBytes) {
  // todo: add additional detection for WACZ besides just zip
  if (isZipFile(fileBytes)) {
    return ".wacz";
  }

  if (isWarcFile(fileBytes)) {
    return ".warc";
  }

  if (isGzFile(fileBytes)) {
    return ".warc.gz";
  }
}

export async function detectFileType(response) {
  const reader = response.body.getReader();
  let fileType = "";
  const { value, done } = await reader.read();
  if (!done && value.length >= PEEK_BYTES) {
    fileType = checkMagicBytes(value.slice(0, PEEK_BYTES));
    if (!fileType) {
      fileType = detectTextType(value);
    }
  }
  if (!done) {
    reader.cancel();
  }
  return fileType;
}