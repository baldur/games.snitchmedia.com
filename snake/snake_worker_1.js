var LEFT = 37
var RIGHT = 39
var UP = 38
var DOWN = 40

var listeners = {
    checkWall: function(evt) {
        switch(evt.data[1]) {
        case LEFT:
          if(0 <= evt.data[3].left) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        case RIGHT:
          if(evt.data[2].width > evt.data[3].left) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        case UP:
          if(0 <= evt.data[3].top) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        case DOWN:
          if(evt.data[2].height > evt.data[3].top) {
              message = ["wall", "ok"];
          } else {
              message = ["wall", "boom"];
          }
          break;
        default:
          //code to be executed if n is different from case 1 and 2
        }
        postMessage(message);
    },
    checkSnake: function(evt) {
        var direction = evt.data[1];
        var currentPos = evt.data[2];
        var snake = evt.data[3];
        switch(direction) {
        case LEFT:
          currentPos.left -= 5;
          for(var i = 0; i<snake.x.length; i++) {
               if(currentPos.left === snake.x[i]) {
                   if(currentPos.top === snake.y[i]) {
                       postMessage(['snake', 'LEFT hit the snake', currentPos, snake]);
                   }
               }
           }
          break;
        case RIGHT:
          currentPos.left += 5;
          for(var i = 0; i<snake.x.length; i++) {
               if(currentPos.left === snake.x[i]) {
                   if(currentPos.top === snake.y[i]) {
                       postMessage(['snake', 'RIGHT hit the snake', currentPos, snake]);
                   }
               }
           }
          break;
        case UP:
          currentPos.top -= 5;
          for(var i = 0; i<snake.y.length; i++) {
               if(currentPos.top === snake.y[i]) {
                   if(currentPos.left === snake.x[i]) {
                       postMessage(['snake', 'UP hit the snake', currentPos, snake]);
                   }
               }
           }
          break;
        case DOWN:
          currentPos.top += 5;
          for(var i = 0; i<snake.y.length; i++) {
               if(currentPos.top === snake.y[i]) {
                   if(currentPos.left === snake.x[i]) {
                       postMessage(['snake', 'DOWN hit the snake', currentPos, snake]);
                   }
               }
           }
          break;
        //
        default:
          //code to be executed if n is different from case 1 and 2
        }

    }
};

onmessage = function (evt) {
    var method = listeners[evt.data[0]];
    if(method){
        method(evt); 
    } else {
        postMessage('dont know how to process this');
    }
};
