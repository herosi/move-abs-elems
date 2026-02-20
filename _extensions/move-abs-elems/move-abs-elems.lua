-- move-abs-elems.lua
-- Quarto Lua filter for making .absolute elements draggable
local counter = 0

function Div(el)
  -- Find elements with the .absolute class
  if el.classes:includes("absolute") then
    
    -- Auto-generate ID if not set
    local elementId = el.identifier
    if elementId == "" then
      elementId = "drag-abs-" .. counter
      el.identifier = elementId
    end
    
    -- Add data attributes for JavaScript identification
    el.attributes["data-draggable"] = "true"
    el.attributes["data-element-id"] = elementId
    el.attributes["data-md-index"] = tostring(counter) -- Order in Markdown source
    
    -- Read top, left, bottom, right attributes and set as data attributes
    if el.attributes["top"] then
      el.attributes["data-top"] = el.attributes["top"]
    end
    if el.attributes["left"] then
      el.attributes["data-left"] = el.attributes["left"]
    end
    if el.attributes["bottom"] then
      el.attributes["data-bottom"] = el.attributes["bottom"]
    end
    if el.attributes["right"] then
      el.attributes["data-right"] = el.attributes["right"]
    end
    
    -- Read width, height attributes and set as data attributes
    if el.attributes["width"] then
      el.attributes["data-width"] = el.attributes["width"]
    end
    if el.attributes["height"] then
      el.attributes["data-height"] = el.attributes["height"]
    end
    
    counter = counter + 1
    
    return el
  end
end

function Image(el)
  -- Find images with the .absolute class
  if el.classes:includes("absolute") then
    
    local elementId = el.identifier
    if elementId == "" then
      elementId = "drag-abs-img-" .. counter
      el.identifier = elementId
    end
    
    el.attributes["data-draggable"] = "true"
    el.attributes["data-element-id"] = elementId
    el.attributes["data-md-index"] = tostring(counter)
    
    -- Read top, left, bottom, right attributes and set as data attributes
    if el.attributes["top"] then
      el.attributes["data-top"] = el.attributes["top"]
    end
    if el.attributes["left"] then
      el.attributes["data-left"] = el.attributes["left"]
    end
    if el.attributes["bottom"] then
      el.attributes["data-bottom"] = el.attributes["bottom"]
    end
    if el.attributes["right"] then
      el.attributes["data-right"] = el.attributes["right"]
    end
    
    -- Read width, height attributes and set as data attributes
    if el.attributes["width"] then
      el.attributes["data-width"] = el.attributes["width"]
    end
    if el.attributes["height"] then
      el.attributes["data-height"] = el.attributes["height"]
    end
    
    counter = counter + 1
    
    return el
  end
end

-- Inject JavaScript only for HTML-based formats
function Meta(meta)
  if quarto.doc.is_format("html") or quarto.doc.is_format("revealjs") then
    -- Relative path from the extension directory
    local script_path = quarto.utils.resolve_path("move-abs-elems.js")
    quarto.doc.add_html_dependency({
      name = "mov-abs-elems",
      scripts = {script_path}
    })
  end
  return meta
end

-- Specify filter execution order
return {
  { Div = Div, Image = Image },
  { Meta = Meta }
}